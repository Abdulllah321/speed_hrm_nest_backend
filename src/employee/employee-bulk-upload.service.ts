import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../database/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { CsvParserService } from '../common/services/csv-parser.service';
import { EmployeeValidatorService } from '../common/services/employee-validator.service';
import { EmployeeUploadEventsService } from './employee-upload-events.service';

@Injectable()
export class EmployeeBulkUploadService {
    private readonly logger = new Logger(EmployeeBulkUploadService.name);

    constructor(
        @InjectQueue('employee-upload') private uploadQueue: Queue,
        private prisma: PrismaService,
        private eventsService: EmployeeUploadEventsService,
    ) { }

    /**
     * Initiate validation of bulk upload file
     */
    async initiateValidation(
        fileBuffer: Buffer,
        filename: string,
        userId: string,
    ): Promise<{ uploadId: string; jobId: string }> {
        const { v4: uuidv4 } = await import('uuid');
        const jobId = `validate-${uuidv4()}`;

        const upload = await this.prisma.bulkUpload.create({
            data: {
                jobId,
                filename,
                totalRecords: 0,
                uploadedBy: userId,
                status: 'validating',
            },
        });

        const uploadDir = path.join(process.cwd(), 'uploads', 'bulk');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const ext = filename.split('.').pop();
        const filePath = path.join(uploadDir, `upload-${upload.id}.${ext}`);
        fs.writeFileSync(filePath, fileBuffer);

        await this.uploadQueue.add({
            uploadId: upload.id,
            filename,
            userId,
            tenantId: this.prisma.getTenantId() || '',
            tenantDbUrl: this.prisma.getTenantDbUrl() || '',
            mode: 'validate',
        } as any, {
            jobId,
            removeOnComplete: false,
            removeOnFail: false,
        });

        this.logger.log(`Employee validation initiated: ${upload.id} (Job ID: ${jobId})`);

        return {
            uploadId: upload.id,
            jobId,
        };
    }

    /**
     * Confirm and start the actual upload
     */
    async confirmUpload(uploadId: string, userId: string): Promise<{ uploadId: string; jobId: string }> {
        const upload = await this.prisma.bulkUpload.findUnique({
            where: { id: uploadId },
        });

        if (!upload) {
            throw new NotFoundException(`Upload ${uploadId} not found`);
        }

        // Idempotent: if already completed, just return — no need to re-import
        if (upload.status === 'completed') {
            this.logger.warn(`Confirm called on already-completed upload ${uploadId} — returning existing jobId`);
            return { uploadId, jobId: upload.jobId };
        }

        if (upload.status !== 'validated') {
            throw new Error(`Upload must be in 'validated' status to be confirmed (current: ${upload.status})`);
        }

        this.eventsService.emit({
            uploadId,
            type: 'status',
            data: { status: 'pending', message: 'Import confirmation received...' }
        });

        await this.prisma.bulkUpload.update({
            where: { id: uploadId },
            data: { status: 'pending', message: 'Confirming upload...' },
        });

        const { v4: uuidv4 } = await import('uuid');
        const importJobId = `import-${uuidv4()}`;

        await this.uploadQueue.add({
            uploadId: upload.id,
            filename: upload.filename,
            userId,
            tenantId: this.prisma.getTenantId() || '',
            tenantDbUrl: this.prisma.getTenantDbUrl() || '',
            mode: 'import',
        } as any, {
            jobId: importJobId,
            removeOnComplete: false,
            removeOnFail: false,
        });

        await this.prisma.bulkUpload.update({
            where: { id: upload.id },
            data: { jobId: importJobId },
        });

        this.logger.log(`Employee import confirmed: ${upload.id} (Job ID: ${importJobId})`);

        return {
            uploadId,
            jobId: importJobId,
        };
    }

    /**
     * Get upload status and progress
     */
    async getUploadStatus(uploadId: string) {
        const upload = await this.prisma.bulkUpload.findUnique({
            where: { id: uploadId },
        });

        if (!upload) {
            throw new NotFoundException(`Upload ${uploadId} not found`);
        }

        let jobProgress = 0;
        let jobState = 'unknown';

        try {
            const job = await this.uploadQueue.getJob(upload.jobId);
            if (job) {
                jobProgress = await job.progress();
                jobState = await job.getState();
            }
        } catch (error) {
            this.logger.warn(`Failed to get job status (${error.message})`);
        }

        return {
            ...upload,
            progress: jobProgress,
            jobState,
        };
    }

    /**
     * Stream error report as CSV
     */
    async streamErrorReport(uploadId: string, res: any): Promise<void> {
        const upload = await this.prisma.bulkUpload.findUnique({ where: { id: uploadId } });
        if (!upload) {
            res.code(404).send({ status: false, message: 'Upload not found' });
            return;
        }

        const errorFilePath = path.join(process.cwd(), 'uploads', 'bulk', `errors-${uploadId}.jsonl`);
        const raw = res.raw;

        raw.writeHead(200, {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="employee-error-report-${uploadId}.csv"`,
            'Transfer-Encoding': 'chunked',
            'Cache-Control': 'no-cache',
        });

        raw.write('Row,EmployeeID,EmployeeName,Field,Reason\n');

        const writeLine = (e: any) => {
            const row = e.row ?? 'N/A';
            const empId = String(e.employeeId ?? '').replace(/"/g, '""');
            const empName = String(e.employeeName ?? '').replace(/"/g, '""');
            const field = e.field ?? 'N/A';
            const reason = String(e.reason ?? '').replace(/"/g, '""');
            raw.write(`${row},"${empId}","${empName}",${field},"${reason}"\n`);
        };

        if (!fs.existsSync(errorFilePath)) {
            const errors = (Array.isArray(upload.errors) ? upload.errors : []) as any[];
            for (const e of errors) writeLine(e);
            raw.end();
            return;
        }

        const { createInterface } = await import('readline');
        const rl = createInterface({ input: fs.createReadStream(errorFilePath), crlfDelay: Infinity });
        rl.on('line', (line) => { if (line.trim()) { try { writeLine(JSON.parse(line)); } catch { } } });
        rl.on('close', () => raw.end());
        rl.on('error', () => raw.end());
    }

    /**
     * Generate dynamic Excel template with master data dropdowns
     */
    async generateTemplate(): Promise<Buffer> {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Employees', {
            views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }]
        });
        const masterSheet = workbook.addWorksheet('MasterData');

        // Fetch master data
        const [
            depts, subDepts, designations, empGrades, locations, empStatuses,
            maritalStatuses, whPolicies, leavesPolicies,
            allocations, countries, states, cities, qualifications, institutes
        ] = await Promise.all([
            this.prisma.department.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
            this.prisma.subDepartment.findMany({ select: { name: true }, distinct: ['name'], orderBy: { name: 'asc' } }),
            this.prisma.designation.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
            this.prisma.employeeGrade.findMany({ select: { grade: true }, orderBy: { grade: 'asc' } }),
            this.prisma.location.findMany({ select: { name: true, shortCode: true }, orderBy: { name: 'asc' } }),
            this.prisma.employeeStatus.findMany({ select: { status: true }, orderBy: { status: 'asc' } }),
            this.prisma.maritalStatus.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
            this.prisma.workingHoursPolicy.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
            this.prisma.leavesPolicy.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
            this.prisma.allocation.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
            this.prisma.country.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
            this.prisma.state.findMany({ select: { name: true }, distinct: ['name'], orderBy: { name: 'asc' } }),
            this.prisma.city.findMany({ select: { name: true }, distinct: ['name'], orderBy: { name: 'asc' } }),
            this.prisma.qualification.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
            this.prisma.institute.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
        ]);

        // Setup Master Data sheet (for dropdowns)
        const masterColumns = [
            { header: 'Departments', key: 'depts', values: depts.map(d => d.name) },
            { header: 'SubDepartments', key: 'subDepts', values: subDepts.map(d => d.name) },
            { header: 'Designations', key: 'designations', values: designations.map(d => d.name) },
            { header: 'EmployeeGrades', key: 'empGrades', values: empGrades.map(d => d.grade) },
            { header: 'Locations', key: 'locations', values: locations.map(d => d.shortCode || d.name) },
            { header: 'EmpStatus', key: 'empStatuses', values: empStatuses.map(s => s.status) },
            { header: 'MaritalStatus', key: 'maritalStatuses', values: maritalStatuses.map(m => m.name) },
            { header: 'WHPolicies', key: 'whPolicies', values: whPolicies.map(p => p.name) },
            { header: 'LeavesPolicies', key: 'leavesPolicies', values: leavesPolicies.map(p => p.name) },
            { header: 'Allocations', key: 'allocations', values: allocations.map(a => a.name) },
            { header: 'Countries', key: 'countries', values: countries.map(c => c.name) },
            { header: 'States', key: 'states', values: states.map(s => s.name) },
            { header: 'Cities', key: 'cities', values: cities.map(c => c.name) },
            { header: 'Qualifications', key: 'qualifications', values: qualifications.map(q => q.name) },
            { header: 'Institutes', key: 'institutes', values: institutes.map(i => i.name) },
            { header: 'Genders', key: 'genders', values: ['male', 'female', 'other'] },
            { header: 'YesNo', key: 'yesNos', values: ['Yes', 'No'] }
        ];

        masterColumns.forEach((col, idx) => {
            const colNum = idx + 1;
            masterSheet.getCell(1, colNum).value = col.header;
            col.values.forEach((val, valIdx) => {
                masterSheet.getCell(valIdx + 2, colNum).value = val;
            });
            // Define named range for clean reference
            const rangeName = col.key;
            const lastRow = col.values.length + 1;
            if (lastRow > 1) {
                const colLetter = String.fromCharCode(64 + colNum);
                workbook.definedNames.add(`MasterData!$${colLetter}$2:$${colLetter}$${lastRow}`, rangeName);
            }
        });

        masterSheet.state = 'hidden';

        // Columns structure matching export
        const columns = [
            // Identity
            { header: 'Employee ID', key: 'employeeId', width: 14, group: 'Identity', align: 'center' },
            { header: 'Employee Name', key: 'employeeName', width: 28, group: 'Identity' },
            { header: 'Father/Husband', key: 'fatherHusbandName', width: 24, group: 'Identity' },
            { header: 'CNIC', key: 'cnicNumber', width: 18, group: 'Identity', align: 'center' },
            { header: 'CNIC Expiry', key: 'cnicExpiryDate', width: 14, group: 'Identity', numFmt: 'yyyy-mm-dd', align: 'center' },
            { header: 'Lifetime CNIC', key: 'lifetimeCnic', width: 13, group: 'Identity', dropdown: 'yesNos', align: 'center' },
            { header: 'Status', key: 'status', width: 11, group: 'Identity', dropdown: 'empStatuses', align: 'center' },
            // Employment
            { header: 'Department', key: 'department', width: 20, group: 'Employment', dropdown: 'depts' },
            { header: 'Sub-Department', key: 'subDepartment', width: 20, group: 'Employment', dropdown: 'subDepts' },
            { header: 'Designation', key: 'designation', width: 20, group: 'Employment', dropdown: 'designations' },
            { header: 'Grade', key: 'employeeGrade', width: 12, group: 'Employment', dropdown: 'empGrades' },
            { header: 'Attendance ID', key: 'attendanceId', width: 14, group: 'Employment', align: 'center' },
            { header: 'Joining Date', key: 'joiningDate', width: 14, group: 'Employment', numFmt: 'yyyy-mm-dd', align: 'center' },
            { header: 'Probation Expiry', key: 'probationExpiryDate', width: 16, group: 'Employment', numFmt: 'yyyy-mm-dd', align: 'center' },
            { header: 'Employment Status', key: 'employmentStatus', width: 18, group: 'Employment', dropdown: 'empStatuses' },
            { header: 'Reporting Manager', key: 'reportingManager', width: 20, group: 'Employment' },
            { header: 'Location', key: 'location', width: 18, group: 'Employment', dropdown: 'locations' },
            { header: 'Allocation', key: 'allocation', width: 16, group: 'Employment', dropdown: 'allocations' },
            { header: 'Working Hours Policy', key: 'workingHoursPolicy', width: 22, group: 'Employment', dropdown: 'whPolicies' },
            { header: 'Leaves Policy', key: 'leavesPolicy', width: 18, group: 'Employment', dropdown: 'leavesPolicies' },
            { header: 'Days Off', key: 'daysOff', width: 12, group: 'Employment' },
            { header: 'Remote Attendance', key: 'allowRemoteAttendance', width: 17, group: 'Employment', dropdown: 'yesNos', align: 'center' },
            { header: 'Overtime', key: 'overtimeApplicable', width: 12, group: 'Employment', dropdown: 'yesNos', align: 'center' },
            // Personal
            { header: 'Date of Birth', key: 'dateOfBirth', width: 14, group: 'Personal', numFmt: 'yyyy-mm-dd', align: 'center' },
            { header: 'Gender', key: 'gender', width: 10, group: 'Personal', dropdown: 'genders', align: 'center' },
            { header: 'Nationality', key: 'nationality', width: 14, group: 'Personal' },
            { header: 'Marital Status', key: 'maritalStatus', width: 14, group: 'Personal', dropdown: 'maritalStatuses' },
            { header: 'Country', key: 'country', width: 14, group: 'Personal', dropdown: 'countries' },
            { header: 'State/Province', key: 'state', width: 16, group: 'Personal', dropdown: 'states' },
            { header: 'City', key: 'city', width: 14, group: 'Personal', dropdown: 'cities' },
            { header: 'Area', key: 'area', width: 14, group: 'Personal' },
            { header: 'Current Address', key: 'currentAddress', width: 30, group: 'Personal' },
            { header: 'Permanent Address', key: 'permanentAddress', width: 30, group: 'Personal' },
            // Contact
            { header: 'Contact Number', key: 'contactNumber', width: 16, group: 'Contact' },
            { header: 'Emergency Contact', key: 'emergencyContactNumber', width: 18, group: 'Contact' },
            { header: 'Emergency Person', key: 'emergencyContactPerson', width: 20, group: 'Contact' },
            { header: 'Personal Email', key: 'personalEmail', width: 26, group: 'Contact' },
            { header: 'Official Email', key: 'officialEmail', width: 26, group: 'Contact' },
            // Financial
            { header: 'Salary', key: 'employeeSalary', width: 14, group: 'Financial', numFmt: '#,##0.00', align: 'right' },
            { header: 'EOBI', key: 'eobi', width: 8, group: 'Financial', dropdown: 'yesNos', align: 'center' },
            { header: 'EOBI Number', key: 'eobiNumber', width: 16, group: 'Financial' },
            { header: 'Provident Fund', key: 'providentFund', width: 14, group: 'Financial', dropdown: 'yesNos', align: 'center' },
            { header: 'Bank Name', key: 'bankName', width: 18, group: 'Financial' },
            { header: 'Account Number', key: 'accountNumber', width: 18, group: 'Financial' },
            { header: 'Account Title', key: 'accountTitle', width: 22, group: 'Financial' },
            // Audit
            { header: 'Created At', key: 'createdAt', width: 18, group: 'Audit', align: 'center' },
            { header: 'Updated At', key: 'updatedAt', width: 18, group: 'Audit', align: 'center' }
        ];

        sheet.columns = columns.map(c => ({ key: c.key, width: c.width }));

        // ── Row 1: Group header bands ────────────────────────────────────────
        const groups: Record<string, { start: number; end: number }> = {};
        columns.forEach((col, idx) => {
            const n = idx + 1;
            if (!groups[col.group]) groups[col.group] = { start: n, end: n };
            else groups[col.group].end = n;
        });

        const GROUP_COLORS: Record<string, string> = {
            Identity:    '1E3A5F',
            Employment:  '1E4D2B',
            Personal:    '4A1942',
            Contact:     '7C3A00',
            Financial:   '1A3A4A',
            Audit:       '3D2B00',
        };
        const BORDER_COLOR = 'CBD5E1';
        const SUBHEADER_BG = '1E3A5F';
        const SUBHEADER_FG = 'F1F5F9';

        const groupRow = sheet.getRow(1);
        columns.forEach((col, idx) => {
            const cell = groupRow.getCell(idx + 1);
            const { start } = groups[col.group];
            if (idx + 1 === start) cell.value = col.group.toUpperCase();
            cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${GROUP_COLORS[col.group] ?? '1E293B'}` } };
            cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border    = {
                top:    { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
                left:   { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
                bottom: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
                right:  { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
            };
        });
        groupRow.height = 22;

        // ── Row 2: Column headers ────────────────────────────────────────────
        const headerRow = sheet.getRow(2);
        columns.forEach((col, idx) => {
            const cell = headerRow.getCell(idx + 1);
            cell.value     = col.header;
            cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SUBHEADER_BG}` } };
            cell.font      = { bold: true, color: { argb: `FF${SUBHEADER_FG}` }, size: 9 };
            cell.alignment = { horizontal: col.align as any ?? 'left', vertical: 'middle' };
            cell.border    = {
                top:    { style: 'thin',   color: { argb: `FF${BORDER_COLOR}` } },
                left:   { style: 'thin',   color: { argb: `FF${BORDER_COLOR}` } },
                bottom: { style: 'medium', color: { argb: `FF${BORDER_COLOR}` } },
                right:  { style: 'thin',   color: { argb: `FF${BORDER_COLOR}` } },
            };
        });
        headerRow.height = 20;

        // Add a sample row (Row 3)
        sheet.addRow({
            employeeId: 'EMP-001',
            employeeName: 'John Doe',
            fatherHusbandName: 'Richard Doe',
            cnicNumber: '12345-1234567-1',
            cnicExpiryDate: '2030-01-01',
            lifetimeCnic: 'No',
            status: 'active',
            department: depts[0]?.name || '',
            subDepartment: subDepts[0]?.name || '',
            designation: designations[0]?.name || '',
            employeeGrade: empGrades[0]?.grade || '',
            attendanceId: 'EMP-001',
            joiningDate: '2024-01-01',
            probationExpiryDate: '2024-04-01',
            employmentStatus: empStatuses[0]?.status || '',
            reportingManager: 'Manager Name',
            location: locations[0]?.name || '',
            allocation: allocations[0]?.name || '',
            workingHoursPolicy: whPolicies[0]?.name || '',
            leavesPolicy: leavesPolicies[0]?.name || '',
            daysOff: 'Sunday',
            allowRemoteAttendance: 'No',
            overtimeApplicable: 'Yes',
            dateOfBirth: '1990-05-15',
            gender: 'male',
            nationality: 'Pakistani',
            maritalStatus: maritalStatuses[0]?.name || '',
            country: countries[0]?.name || '',
            state: states[0]?.name || '',
            city: cities[0]?.name || '',
            area: 'Area Name',
            currentAddress: 'Current Address Detail',
            permanentAddress: 'Permanent Address Detail',
            contactNumber: '0300-1234567',
            emergencyContactNumber: '0300-7654321',
            emergencyContactPerson: 'Emergency Person Name',
            personalEmail: 'john.doe@personal.com',
            officialEmail: 'john.doe@company.com',
            employeeSalary: 50000,
            eobi: 'No',
            providentFund: 'No',
            bankName: 'Bank Name',
            accountNumber: '1234567890',
            accountTitle: 'John Doe Account'
        });

        // Set style for data row (Row 3)
        const sampleRow = sheet.getRow(3);
        columns.forEach((col, colIdx) => {
            const cell = sampleRow.getCell(colIdx + 1);
            if (col.numFmt) cell.numFmt = col.numFmt;
            cell.alignment = { horizontal: col.align as any ?? 'left', vertical: 'middle' };
            cell.font = { size: 9 };
            cell.border = {
                top:    { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
                left:   { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
                bottom: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
                right:  { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
            };
        });
        sampleRow.height = 18;

        // Apply dropdowns to a range of rows (e.g. 3 to 500)
        columns.forEach((col, idx) => {
            if (col.dropdown) {
                const colLetter = sheet.getColumn(idx + 1).letter;
                for (let row = 3; row <= 500; row++) {
                    sheet.getCell(`${colLetter}${row}`).dataValidation = {
                        type: 'list',
                        allowBlank: true,
                        formulae: [col.dropdown]
                    };
                }
            }
        });

        return workbook.xlsx.writeBuffer() as unknown as Promise<Buffer>;
    }
}
