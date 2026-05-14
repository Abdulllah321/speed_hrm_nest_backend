import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface EmployeeExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  search?: string;
  departmentId?: string;
  designationId?: string;
  status?: string;
}

// ── Colour palette ─────────────────────────────────────────────────────────────
const SUBHEADER_BG = '1E3A5F';
const SUBHEADER_FG = 'F1F5F9';
const ALT_ROW_BG   = 'F0F4F8';
const BORDER_COLOR = 'CBD5E1';
const ACTIVE_FG    = '15803D';
const INACTIVE_FG  = 'B91C1C';
const SALARY_FG    = '0F766E';

const GROUP_COLORS: Record<string, string> = {
  Identity:    '1E3A5F',
  Employment:  '1E4D2B',
  Personal:    '4A1942',
  Contact:     '7C3A00',
  Financial:   '1A3A4A',
  Audit:       '3D2B00',
};

const COLUMNS: {
  header: string;
  key: string;
  width: number;
  group: string;
  numFmt?: string;
  align?: ExcelJS.Alignment['horizontal'];
}[] = [
  // Identity
  { header: 'Employee ID',        key: 'employeeId',            width: 14, group: 'Identity',   align: 'center' },
  { header: 'Employee Name',      key: 'employeeName',          width: 28, group: 'Identity' },
  { header: 'Father/Husband',     key: 'fatherHusbandName',     width: 24, group: 'Identity' },
  { header: 'CNIC',               key: 'cnicNumber',            width: 18, group: 'Identity',   align: 'center' },
  { header: 'CNIC Expiry',        key: 'cnicExpiryDate',        width: 14, group: 'Identity',   numFmt: 'dd-mmm-yyyy', align: 'center' },
  { header: 'Lifetime CNIC',      key: 'lifetimeCnic',          width: 13, group: 'Identity',   align: 'center' },
  { header: 'Status',             key: 'status',                width: 11, group: 'Identity',   align: 'center' },
  // Employment
  { header: 'Department',         key: 'department',            width: 20, group: 'Employment' },
  { header: 'Sub-Department',     key: 'subDepartment',         width: 20, group: 'Employment' },
  { header: 'Designation',        key: 'designation',           width: 20, group: 'Employment' },
  { header: 'Grade',              key: 'employeeGrade',         width: 12, group: 'Employment' },
  { header: 'Attendance ID',      key: 'attendanceId',          width: 14, group: 'Employment',  align: 'center' },
  { header: 'Joining Date',       key: 'joiningDate',           width: 14, group: 'Employment',  numFmt: 'dd-mmm-yyyy', align: 'center' },
  { header: 'Probation Expiry',   key: 'probationExpiryDate',   width: 16, group: 'Employment',  numFmt: 'dd-mmm-yyyy', align: 'center' },
  { header: 'Employment Status',  key: 'employmentStatus',      width: 18, group: 'Employment' },
  { header: 'Reporting Manager',  key: 'reportingManager',      width: 20, group: 'Employment' },
  { header: 'Location',           key: 'location',              width: 18, group: 'Employment' },
  { header: 'Allocation',         key: 'allocation',            width: 16, group: 'Employment' },
  { header: 'Working Hours Policy', key: 'workingHoursPolicy',  width: 22, group: 'Employment' },
  { header: 'Leaves Policy',      key: 'leavesPolicy',          width: 18, group: 'Employment' },
  { header: 'Days Off',           key: 'daysOff',               width: 12, group: 'Employment' },
  { header: 'Remote Attendance',  key: 'allowRemoteAttendance', width: 17, group: 'Employment',  align: 'center' },
  { header: 'Overtime',           key: 'overtimeApplicable',    width: 12, group: 'Employment',  align: 'center' },
  // Personal
  { header: 'Date of Birth',      key: 'dateOfBirth',           width: 14, group: 'Personal',    numFmt: 'dd-mmm-yyyy', align: 'center' },
  { header: 'Gender',             key: 'gender',                width: 10, group: 'Personal',    align: 'center' },
  { header: 'Nationality',        key: 'nationality',           width: 14, group: 'Personal' },
  { header: 'Marital Status',     key: 'maritalStatus',         width: 14, group: 'Personal' },
  { header: 'Country',            key: 'country',               width: 14, group: 'Personal' },
  { header: 'State/Province',     key: 'state',                 width: 16, group: 'Personal' },
  { header: 'City',               key: 'city',                  width: 14, group: 'Personal' },
  { header: 'Area',               key: 'area',                  width: 14, group: 'Personal' },
  { header: 'Current Address',    key: 'currentAddress',        width: 30, group: 'Personal' },
  { header: 'Permanent Address',  key: 'permanentAddress',      width: 30, group: 'Personal' },
  // Contact
  { header: 'Contact Number',     key: 'contactNumber',         width: 16, group: 'Contact' },
  { header: 'Emergency Contact',  key: 'emergencyContactNumber',width: 18, group: 'Contact' },
  { header: 'Emergency Person',   key: 'emergencyContactPerson',width: 20, group: 'Contact' },
  { header: 'Personal Email',     key: 'personalEmail',         width: 26, group: 'Contact' },
  { header: 'Official Email',     key: 'officialEmail',         width: 26, group: 'Contact' },
  // Financial
  { header: 'Salary',             key: 'employeeSalary',        width: 14, group: 'Financial',   numFmt: '#,##0.00', align: 'right' },
  { header: 'EOBI',               key: 'eobi',                  width: 8,  group: 'Financial',   align: 'center' },
  { header: 'EOBI Number',        key: 'eobiNumber',            width: 16, group: 'Financial' },
  { header: 'Provident Fund',     key: 'providentFund',         width: 14, group: 'Financial',   align: 'center' },
  { header: 'Bank Name',          key: 'bankName',              width: 18, group: 'Financial' },
  { header: 'Account Number',     key: 'accountNumber',         width: 18, group: 'Financial' },
  { header: 'Account Title',      key: 'accountTitle',          width: 22, group: 'Financial' },
  // Audit
  { header: 'Created At',         key: 'createdAt',             width: 18, group: 'Audit',       numFmt: 'dd-mmm-yyyy hh:mm', align: 'center' },
  { header: 'Updated At',         key: 'updatedAt',             width: 18, group: 'Audit',       numFmt: 'dd-mmm-yyyy hh:mm', align: 'center' },
];

@Processor('employee-export')
export class EmployeeExportProcessor {
  private readonly logger = new Logger(EmployeeExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
  ) {}

  @Process()
  async handleExport(job: Job<EmployeeExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, search, departmentId, designationId, status } = job.data;

    this.logger.log(`[EmployeeExport ${jobId}] Starting for user ${userId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const filePath = path.join(exportDir, `export-${jobId}.xlsx`);

    try {
      // ── Build WHERE ──────────────────────────────────────────────────────
      const andClauses: any[] = [];
      if (search) {
        const t = search.trim();
        andClauses.push({
          OR: [
            { employeeName:  { contains: t, mode: 'insensitive' } },
            { employeeId:    { contains: t, mode: 'insensitive' } },
            { officialEmail: { contains: t, mode: 'insensitive' } },
            { contactNumber: { contains: t, mode: 'insensitive' } },
            { cnicNumber:    { contains: t, mode: 'insensitive' } },
          ],
        });
      }
      if (departmentId)  andClauses.push({ departmentId });
      if (designationId) andClauses.push({ designationId });
      if (status)        andClauses.push({ status });
      const where: any = andClauses.length ? { AND: andClauses } : {};

      const total = await prisma.employee.count({ where });
      this.logger.log(`[EmployeeExport ${jobId}] ${total} rows to export`);

      // ── Streaming workbook writer ────────────────────────────────────────
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        filename: filePath,
        useStyles: true,
        useSharedStrings: false,
      });

      const ws = workbook.addWorksheet('Employees', {
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
        views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }],
      });

      ws.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));

      // ── Row 1: Group header bands ────────────────────────────────────────
      const groups: Record<string, { start: number; end: number }> = {};
      COLUMNS.forEach((col, idx) => {
        const n = idx + 1;
        if (!groups[col.group]) groups[col.group] = { start: n, end: n };
        else groups[col.group].end = n;
      });

      const groupRow = ws.getRow(1);
      COLUMNS.forEach((col, idx) => {
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
      groupRow.commit();

      // ── Row 2: Column headers ────────────────────────────────────────────
      const headerRow = ws.getRow(2);
      COLUMNS.forEach((col, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value     = col.header;
        cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SUBHEADER_BG}` } };
        cell.font      = { bold: true, color: { argb: `FF${SUBHEADER_FG}` }, size: 9 };
        cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
        cell.border    = {
          top:    { style: 'thin',   color: { argb: `FF${BORDER_COLOR}` } },
          left:   { style: 'thin',   color: { argb: `FF${BORDER_COLOR}` } },
          bottom: { style: 'medium', color: { argb: `FF${BORDER_COLOR}` } },
          right:  { style: 'thin',   color: { argb: `FF${BORDER_COLOR}` } },
        };
      });
      headerRow.height = 20;
      headerRow.commit();

      // ── Data rows — cursor-paginated in chunks of 500 ────────────────────
      const CHUNK = 500;
      let cursor: string | undefined;
      let rowIdx = 0;
      let processed = 0;

      while (true) {
        const chunk = await prisma.employee.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: CHUNK,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          include: {
            department:         { select: { name: true } },
            subDepartment:      { select: { name: true } },
            designation:        { select: { name: true } },
            employeeGrade:      { select: { grade: true } },
            maritalStatus:      { select: { name: true } },
            employmentStatus:   { select: { status: true } },
            country:            { select: { name: true } },
            state:              { select: { name: true } },
            city:               { select: { name: true } },
            location:           { select: { name: true } },
            allocation:         { select: { name: true } },
            workingHoursPolicy: { select: { name: true } },
            leavesPolicy:       { select: { name: true } },
          },
        });

        if (!chunk.length) break;

        for (const emp of chunk) {
          const isAlt = rowIdx % 2 === 1;
          const isInactive = emp.status !== 'active';

          const rowData: Record<string, any> = {
            employeeId:             emp.employeeId,
            employeeName:           emp.employeeName,
            fatherHusbandName:      emp.fatherHusbandName ?? '',
            cnicNumber:             emp.cnicNumber,
            cnicExpiryDate:         emp.cnicExpiryDate ? new Date(emp.cnicExpiryDate) : null,
            lifetimeCnic:           emp.lifetimeCnic ? 'Yes' : 'No',
            status:                 emp.status,
            department:             (emp as any).department?.name ?? '',
            subDepartment:          (emp as any).subDepartment?.name ?? '',
            designation:            (emp as any).designation?.name ?? '',
            employeeGrade:          (emp as any).employeeGrade?.grade ?? '',
            attendanceId:           emp.attendanceId,
            joiningDate:            emp.joiningDate ? new Date(emp.joiningDate) : null,
            probationExpiryDate:    emp.probationExpiryDate ? new Date(emp.probationExpiryDate) : null,
            employmentStatus:       (emp as any).employmentStatus?.status ?? '',
            reportingManager:       emp.reportingManager ?? '',
            location:               (emp as any).location?.name ?? '',
            allocation:             (emp as any).allocation?.name ?? '',
            workingHoursPolicy:     (emp as any).workingHoursPolicy?.name ?? '',
            leavesPolicy:           (emp as any).leavesPolicy?.name ?? '',
            daysOff:                emp.daysOff ?? '',
            allowRemoteAttendance:  emp.allowRemoteAttendance ? 'Yes' : 'No',
            overtimeApplicable:     emp.overtimeApplicable ? 'Yes' : 'No',
            dateOfBirth:            emp.dateOfBirth ? new Date(emp.dateOfBirth) : null,
            gender:                 emp.gender,
            nationality:            emp.nationality,
            maritalStatus:          (emp as any).maritalStatus?.name ?? '',
            country:                (emp as any).country?.name ?? '',
            state:                  (emp as any).state?.name ?? '',
            city:                   (emp as any).city?.name ?? '',
            area:                   emp.area ?? '',
            currentAddress:         emp.currentAddress ?? '',
            permanentAddress:       emp.permanentAddress ?? '',
            contactNumber:          emp.contactNumber,
            emergencyContactNumber: emp.emergencyContactNumber ?? '',
            emergencyContactPerson: emp.emergencyContactPerson ?? '',
            personalEmail:          emp.personalEmail ?? '',
            officialEmail:          emp.officialEmail ?? '',
            employeeSalary:         Number(emp.employeeSalary ?? 0),
            eobi:                   emp.eobi ? 'Yes' : 'No',
            eobiNumber:             emp.eobiNumber ?? '',
            providentFund:          emp.providentFund ? 'Yes' : 'No',
            bankName:               emp.bankName ?? '',
            accountNumber:          emp.accountNumber ?? '',
            accountTitle:           emp.accountTitle ?? '',
            createdAt:              new Date(emp.createdAt),
            updatedAt:              new Date(emp.updatedAt),
          };

          const dataRow = ws.getRow(rowIdx + 3);
          COLUMNS.forEach((col, colIdx) => {
            const cell = dataRow.getCell(colIdx + 1);
            cell.value     = rowData[col.key] ?? null;
            if (col.numFmt) cell.numFmt = col.numFmt;
            cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
            cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${isAlt ? ALT_ROW_BG : 'FFFFFF'}` } };

            if (col.key === 'status') {
              cell.font = { bold: true, size: 9, color: { argb: isInactive ? `FF${INACTIVE_FG}` : `FF${ACTIVE_FG}` } };
            } else if (col.key === 'employeeSalary') {
              cell.font = { size: 9, color: { argb: `FF${SALARY_FG}` } };
            } else {
              cell.font = { size: 9 };
            }

            cell.border = {
              top:    { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
              left:   { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
              bottom: { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
              right:  { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
            };
          });
          dataRow.height = 16;
          dataRow.commit();
          rowIdx++;
        }

        processed += chunk.length;
        cursor = chunk[chunk.length - 1].id;

        const pct = total > 0 ? Math.round((processed / total) * 95) : 50;
        await job.progress(pct);
        await new Promise((r) => setImmediate(r));

        if (chunk.length < CHUNK) break;
      }

      // ── Summary sheet ────────────────────────────────────────────────────
      const summary = workbook.addWorksheet('Summary');
      summary.columns = [{ key: 'label', width: 28 }, { key: 'value', width: 22 }];

      const titleRow = summary.getRow(1);
      titleRow.getCell(1).value     = 'Employee Export Summary';
      titleRow.getCell(1).font      = { bold: true, size: 14, color: { argb: 'FF1E293B' } };
      titleRow.getCell(1).fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      titleRow.height = 28;
      titleRow.commit();

      const summaryRows = [
        ['Export Date',       new Date().toLocaleString('en-PK')],
        ['Total Employees',   rowIdx],
        ['Search Filter',     search ?? '(none)'],
        ['Department Filter', departmentId ?? '(all)'],
        ['Designation Filter',designationId ?? '(all)'],
        ['Status Filter',     status ?? '(all)'],
      ];
      summaryRows.forEach(([label, value], idx) => {
        const r = summary.getRow(idx + 2);
        r.getCell(1).value = label;
        r.getCell(1).font  = { bold: true, size: 10 };
        r.getCell(1).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF' } };
        r.getCell(2).value = value;
        r.getCell(2).font  = { size: 10 };
        r.getCell(2).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF' } };
        r.height = 18;
        r.commit();
      });

      await workbook.commit();
      await job.progress(100);

      this.logger.log(`[EmployeeExport ${jobId}] File written (${rowIdx} rows)`);

      await this.notificationsService.create({
        userId,
        title: 'Employee Export Ready',
        message: `Your export of ${rowIdx.toLocaleString()} employee${rowIdx !== 1 ? 's' : ''} is ready to download.`,
        category: 'export',
        priority: 'high',
        actionType: 'employee-export.ready',
        actionPayload: { jobId },
        entityType: 'employee-export',
        entityId: jobId,
        channels: ['inApp'],
      });

    } catch (error: any) {
      this.logger.error(`[EmployeeExport ${jobId}] FAILED: ${error.message}`, error.stack);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      await this.notificationsService.create({
        userId,
        title: 'Employee Export Failed',
        message: `Export could not be completed: ${error.message}`,
        category: 'export',
        priority: 'urgent',
        channels: ['inApp'],
      });
    } finally {
      await prisma.$disconnect();
    }
  }
}
