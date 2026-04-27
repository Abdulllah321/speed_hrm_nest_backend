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
        const sheet = workbook.addWorksheet('Employee Import');
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
            this.prisma.location.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
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
            { header: 'Locations', key: 'locations', values: locations.map(d => d.name) },
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
            { header: 'Genders', key: 'genders', values: ['male', 'female', 'other'] }
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

        // Setup Import Sheet
        const columns = [
            { header: 'Employee ID', key: 'employeeId', width: 15 },
            { header: 'Employee Name', key: 'employeeName', width: 25 },
            { header: 'Father/Husband Name', key: 'fatherHusbandName', width: 25 },
            { header: 'CNIC Number', key: 'cnicNumber', width: 20 },
            { header: 'CNIC Expiry Date', key: 'cnicExpiryDate', width: 18 },
            { header: 'Joining Date', key: 'joiningDate', width: 15 },
            { header: 'Date of Birth', key: 'dateOfBirth', width: 15 },
            { header: 'Gender', key: 'gender', width: 12, dropdown: 'genders' },
            { header: 'Contact Number', key: 'contactNumber', width: 18 },
            { header: 'Personal Email', key: 'personalEmail', width: 25 },
            { header: 'Official Email', key: 'officialEmail', width: 25 },
            { header: 'Attendance ID', key: 'attendanceId', width: 15 },
            { header: 'Current Address', key: 'currentAddress', width: 40 },
            { header: 'Permanent Address', key: 'permanentAddress', width: 40 },
            { header: 'Employee Salary', key: 'employeeSalary', width: 15 },
            { header: 'Bank Name', key: 'bankName', width: 20 },
            { header: 'Account Number', key: 'accountNumber', width: 20 },
            { header: 'Account Title', key: 'accountTitle', width: 25 },
            { header: 'Department', key: 'department', width: 20, dropdown: 'depts' },
            { header: 'Sub Department', key: 'subDepartment', width: 20, dropdown: 'subDepts' },
            { header: 'Designation', key: 'designation', width: 20, dropdown: 'designations' },
            { header: 'Employee Grade', key: 'employeeGrade', width: 20, dropdown: 'empGrades' },
            { header: 'Branch/Location', key: 'branch', width: 20, dropdown: 'locations' },
            { header: 'Employment Status', key: 'employmentStatus', width: 20, dropdown: 'empStatuses' },
            { header: 'Marital Status', key: 'maritalStatus', width: 15, dropdown: 'maritalStatuses' },
            { header: 'Working Hours Policy', key: 'workingHoursPolicy', width: 25, dropdown: 'whPolicies' },
            { header: 'Leaves Policy', key: 'leavesPolicy', width: 25, dropdown: 'leavesPolicies' },
            { header: 'Allocation', key: 'allocation', width: 20, dropdown: 'allocations' },
            { header: 'Country', key: 'country', width: 20, dropdown: 'countries' },
            { header: 'State', key: 'state', width: 20, dropdown: 'states' },
            { header: 'City', key: 'city', width: 20, dropdown: 'cities' },
            { header: 'Qualification', key: 'qualification', width: 20, dropdown: 'qualifications' },
            { header: 'Institute', key: 'institute', width: 25, dropdown: 'institutes' },
            { header: 'Passing Year', key: 'passingYear', width: 15 },
            { header: 'Grade/CGPA', key: 'grade', width: 15 }
        ];

        sheet.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width }));

        // Styling
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } };
        sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
        sheet.getRow(1).height = 25;

        // Add a sample row (do this FIRST before expanding sheet dimensions for validation)
        sheet.addRow({
            employeeId: 'EMP-001',
            employeeName: 'John Doe',
            fatherHusbandName: 'Richard Doe',
            cnicNumber: '12345-1234567-1',
            cnicExpiryDate: '2030-01-01',
            joiningDate: '2024-01-01',
            dateOfBirth: '1990-05-15',
            gender: 'male',
            contactNumber: '0300-1234567',
            employeeSalary: 50000,
            accountTitle: 'John Doe Account'
        });

        // Apply dropdowns to a range of rows (e.g. 2 to 500)
        columns.forEach((col, idx) => {
            if (col.dropdown) {
                const colLetter = sheet.getColumn(idx + 1).letter;
                for (let row = 2; row <= 500; row++) {
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
