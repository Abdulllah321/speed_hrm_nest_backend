import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ExportHistoryService } from '../warehouse/export-history/export-history.service';

export interface LoanRequestExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
}

// ── Colour palette ─────────────────────────────────────────────────────────────
const HEADER_BG    = '1E3A5F';
const HEADER_FG    = 'FFFFFF';
const SUBHEADER_BG = '4472C4';
const SUBHEADER_FG = 'FFFFFF';
const EMP_NAME_BG  = 'D9E2F3';
const SUBTOTAL_BG  = 'FFF2CC';
const GRAND_BG     = 'E2EFDA';
const BORDER_COLOR = 'B4C6E7';
const CURRENCY_FMT = '#,##0';

/** Month abbreviations */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Build month label like "Jul-26" */
function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]}-${String(year).slice(-2)}`;
}

/** Determine current Pakistani fiscal year (Jul → Jun) */
function getFiscalYear(): { startMonth: number; startYear: number; endMonth: number; endYear: number } {
  const now = new Date();
  const m = now.getMonth() + 1; // 1-based
  const y = now.getFullYear();
  if (m >= 7) {
    return { startMonth: 7, startYear: y, endMonth: 6, endYear: y + 1 };
  }
  return { startMonth: 7, startYear: y - 1, endMonth: 6, endYear: y };
}

/** Generate ordered list of months from fiscal start to end */
function getFiscalMonths(fy: ReturnType<typeof getFiscalYear>): { year: number; month: number }[] {
  const months: { year: number; month: number }[] = [];
  let y = fy.startYear;
  let m = fy.startMonth;
  while (true) {
    months.push({ year: y, month: m });
    if (y === fy.endYear && m === fy.endMonth) break;
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

function thinBorder(): Partial<ExcelJS.Borders> {
  return {
    top: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
    left: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
    bottom: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
    right: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
  };
}

@Processor('loan-request-export')
export class LoanRequestExportProcessor {
  private readonly logger = new Logger(LoanRequestExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly exportHistoryService: ExportHistoryService,
  ) {}

  @Process()
  async handleExport(job: Job<LoanRequestExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl } = job.data;

    this.logger.log(`[LoanRequestExport ${jobId}] Starting for user ${userId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const filePath = path.join(exportDir, `export-${jobId}.xlsx`);

    try {
      const fy = getFiscalYear();
      const fiscalMonths = getFiscalMonths(fy);

      // ── Fetch all approved/disbursed/completed loan requests ────────────
      const loanRequests = await prisma.loanRequest.findMany({
        where: {
          status: { in: ['approved', 'disbursed', 'completed'] },
        },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
              departmentId: true,
              subDepartmentId: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (loanRequests.length === 0) {
        this.logger.log(`[LoanRequestExport ${jobId}] No loan requests to export`);
        // Still create file with header only
      }

      // Fetch department/sub-department names for abbreviations
      const deptIds = [...new Set(loanRequests.map(lr => lr.employee?.departmentId).filter(Boolean))] as string[];
      const subDeptIds = [...new Set(loanRequests.map(lr => lr.employee?.subDepartmentId).filter(Boolean))] as string[];

      const [departments, subDepartments] = await Promise.all([
        deptIds.length > 0
          ? prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } })
          : [],
        subDeptIds.length > 0
          ? prisma.subDepartment.findMany({ where: { id: { in: subDeptIds } }, select: { id: true, name: true } })
          : [],
      ]);

      const deptMap = new Map<string, { id: string; name: string }>(
        departments.map(d => [d.id, d] as [string, { id: string; name: string }])
      );
      const subDeptMap = new Map<string, { id: string; name: string }>(
        subDepartments.map(sd => [sd.id, sd] as [string, { id: string; name: string }])
      );

      // Fetch loan types
      const loanTypeIds = [...new Set(loanRequests.map(lr => lr.loanTypeId).filter(Boolean))] as string[];
      const loanTypes = loanTypeIds.length > 0
        ? await prisma.loanType.findMany({ where: { id: { in: loanTypeIds } }, select: { id: true, name: true } })
        : [];
      const loanTypeMap = new Map<string, { id: string; name: string }>(
        loanTypes.map(lt => [lt.id, lt] as [string, { id: string; name: string }])
      );

      // Fetch actual payroll deductions for each employee in the fiscal year
      const employeeIds = [...new Set(loanRequests.map(lr => lr.employeeId))];

      // Build monthYear strings for fiscal year for filtering
      const fiscalMonthYears = fiscalMonths.map(fm => `${fm.year}-${String(fm.month).padStart(2, '0')}`);

      const payrollDetails = employeeIds.length > 0
        ? await prisma.payrollDetail.findMany({
            where: {
              employeeId: { in: employeeIds },
              payroll: {
                status: 'confirmed',
              },
            },
            select: {
              employeeId: true,
              loanDeduction: true,
              payroll: {
                select: { month: true, year: true },
              },
            },
          })
        : [];

      // Build map: employeeId → { "YYYY-MM" → deductionAmount }
      const deductionMap = new Map<string, Map<string, number>>();
      for (const pd of payrollDetails) {
        const empId = pd.employeeId;
        const monthYear = `${pd.payroll.year}-${String(pd.payroll.month).padStart(2, '0')}`;
        if (!deductionMap.has(empId)) deductionMap.set(empId, new Map());
        const existing = deductionMap.get(empId)!.get(monthYear) || 0;
        deductionMap.get(empId)!.set(monthYear, existing + Number(pd.loanDeduction || 0));
      }

      // ── Streaming workbook writer ──────────────────────────────────────
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        filename: filePath,
        useStyles: true,
        useSharedStrings: false,
      });

      const ws = workbook.addWorksheet('Employee Loan Account', {
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
      });

      // Set column widths: Month | Voucher No. | Date | Amount | Monthly Installment | Balance
      ws.columns = [
        { key: 'month', width: 12 },
        { key: 'voucherNo', width: 20 },
        { key: 'voucherDate', width: 14 },
        { key: 'amount', width: 16 },
        { key: 'installment', width: 18 },
        { key: 'balance', width: 16 },
      ];

      let currentRow = 1;

      // ── Row 1: Company Name ────────────────────────────────────────────
      const titleRow = ws.getRow(currentRow);
      titleRow.getCell(1).value = 'Speed (Private) Limited';
      titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: `FF${HEADER_BG}` } };
      titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      titleRow.height = 26;
      ws.mergeCells(currentRow, 1, currentRow, 6);
      titleRow.commit();
      currentRow++;

      // ── Row 2: Report Title ────────────────────────────────────────────
      const subtitleRow = ws.getRow(currentRow);
      subtitleRow.getCell(1).value = 'Employee Loan Account';
      subtitleRow.getCell(1).font = { bold: true, size: 12, color: { argb: `FF${HEADER_BG}` } };
      subtitleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      subtitleRow.height = 22;
      ws.mergeCells(currentRow, 1, currentRow, 6);
      subtitleRow.commit();
      currentRow++;

      // ── Row 3: Period ──────────────────────────────────────────────────
      const fyStartLabel = `${MONTH_NAMES[fy.startMonth - 1].toUpperCase()} ${fy.startYear}`;
      const fyEndLabel = `${MONTH_NAMES[fy.endMonth - 1].toUpperCase()} ${fy.endYear}`;
      const periodRow = ws.getRow(currentRow);
      periodRow.getCell(1).value = `FOR THE PERIOD FROM ${fyStartLabel} TO ${fyEndLabel}`;
      periodRow.getCell(1).font = { bold: true, size: 10, color: { argb: 'FF374151' } };
      periodRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      periodRow.height = 20;
      ws.mergeCells(currentRow, 1, currentRow, 6);
      periodRow.commit();
      currentRow++;

      // ── Row 4: Empty ───────────────────────────────────────────────────
      const emptyRow1 = ws.getRow(currentRow);
      emptyRow1.commit();
      currentRow++;

      // ── Row 5: Column Headers ──────────────────────────────────────────
      const headerLabels = ['Month', 'Payment Voucher', '', ' Amount ', ' Monthly  ', ' Balance '];
      const headerLabels2 = ['', 'No.', 'Date', '', ' Installment ', ''];
      const headerRow = ws.getRow(currentRow);
      headerLabels.forEach((label, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = label;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SUBHEADER_BG}` } };
        cell.font = { bold: true, color: { argb: `FF${SUBHEADER_FG}` }, size: 10 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = thinBorder();
      });
      headerRow.height = 18;
      headerRow.commit();
      currentRow++;

      // Sub-header row
      const headerRow2 = ws.getRow(currentRow);
      headerLabels2.forEach((label, idx) => {
        const cell = headerRow2.getCell(idx + 1);
        cell.value = label;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SUBHEADER_BG}` } };
        cell.font = { bold: true, color: { argb: `FF${SUBHEADER_FG}` }, size: 10 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = thinBorder();
      });
      headerRow2.height = 18;
      headerRow2.commit();
      currentRow++;

      // ── Row 7: Empty ───────────────────────────────────────────────────
      const emptyRow2 = ws.getRow(currentRow);
      emptyRow2.commit();
      currentRow++;

      // ── Row 8: Grand Total (placeholder — will be set at end, but streaming doesn't allow going back)
      // We need to calculate grand totals first, so let's pre-compute
      let grandTotalAmount = 0;
      let grandTotalInstallment = 0;
      let grandTotalBalance = 0;

      // Pre-compute per-employee data
      interface EmployeeLoanData {
        empName: string;
        deptAbbrev: string;
        loanAmount: number;
        repaymentStart: string | null;
        numberOfInstallments: number | null;
        requestedDate: Date | null;
        employeeId: string;
        loanTypeId: string;
      }

      const employeeLoanDataList: EmployeeLoanData[] = loanRequests.map(lr => {
        const emp = lr.employee;
        const empName = emp?.employeeName || 'Unknown';

        // Build department abbreviation
        let deptAbbrev = '';
        if (emp?.subDepartmentId) {
          const sd = subDeptMap.get(emp.subDepartmentId);
          deptAbbrev = sd?.name || '';
        }
        if (!deptAbbrev && emp?.departmentId) {
          const dept = deptMap.get(emp.departmentId);
          deptAbbrev = dept?.name || '';
        }

        return {
          empName,
          deptAbbrev,
          loanAmount: Number(lr.amount),
          repaymentStart: lr.repaymentStartMonthYear,
          numberOfInstallments: lr.numberOfInstallments,
          requestedDate: lr.requestedDate,
          employeeId: lr.employeeId,
          loanTypeId: lr.loanTypeId,
        };
      });

      // Pre-compute totals for each employee
      interface EmployeeMonthRow {
        monthLabel: string;
        voucherNo: string;
        voucherDate: string;
        amount: number | null;
        installment: number | null;
        balance: number;
      }

      interface EmployeeSection {
        empDisplayName: string;
        rows: EmployeeMonthRow[];
        totalAmount: number;
        totalInstallment: number;
        finalBalance: number;
      }

      const sections: EmployeeSection[] = [];

      for (const eld of employeeLoanDataList) {
        const loanAmount = eld.loanAmount;
        const installments = eld.numberOfInstallments || 12;
        const installmentAmount = Math.round(loanAmount / installments);

        // Determine repayment start
        let repStartYear = 0;
        let repStartMonth = 0;
        if (eld.repaymentStart) {
          const [y, m] = eld.repaymentStart.split('-').map(Number);
          repStartYear = y;
          repStartMonth = m;
        } else if (eld.requestedDate) {
          const rd = new Date(eld.requestedDate);
          repStartYear = rd.getFullYear();
          repStartMonth = rd.getMonth() + 1; // next month
          repStartMonth++;
          if (repStartMonth > 12) { repStartMonth = 1; repStartYear++; }
        }

        // Build display name
        const displayName = eld.deptAbbrev
          ? `${eld.empName}-${eld.deptAbbrev}`
          : eld.empName;

        // Get actual deductions from payroll
        const empDeductions = deductionMap.get(eld.employeeId) || new Map<string, number>();

        const rows: EmployeeMonthRow[] = [];
        let balance = loanAmount;
        let totalInstPaid = 0;
        let isFirstRow = true;
        let paidInstallmentCount = 0;

        for (const fm of fiscalMonths) {
          const myKey = `${fm.year}-${String(fm.month).padStart(2, '0')}`;
          const label = monthLabel(fm.year, fm.month);

          // Check if this month is at or after repayment start
          const isAfterRepStart = repStartYear > 0 && (
            fm.year > repStartYear || (fm.year === repStartYear && fm.month >= repStartMonth)
          );

          // Determine installment: use actual payroll deduction if available,
          // otherwise use calculated amount if within repayment period
          let inst: number | null = null;
          const actualDeduction = empDeductions.get(myKey);

          if (actualDeduction && actualDeduction > 0) {
            inst = actualDeduction;
          } else if (isAfterRepStart && paidInstallmentCount < installments) {
            inst = installmentAmount;
          }

          if (inst !== null && inst > 0) {
            balance = Math.max(0, balance - inst);
            totalInstPaid += inst;
            paidInstallmentCount++;
          }

          const row: EmployeeMonthRow = {
            monthLabel: label,
            voucherNo: '',
            voucherDate: '',
            amount: isFirstRow ? loanAmount : null,
            installment: inst,
            balance,
          };

          // First row gets the request date as voucher date
          if (isFirstRow && eld.requestedDate) {
            const rd = new Date(eld.requestedDate);
            row.voucherDate = `${rd.getMonth() + 1}/${rd.getDate()}/${String(rd.getFullYear()).slice(-2)}`;
          }

          rows.push(row);
          isFirstRow = false;
        }

        sections.push({
          empDisplayName: displayName,
          rows,
          totalAmount: loanAmount,
          totalInstallment: totalInstPaid,
          finalBalance: balance,
        });

        grandTotalAmount += loanAmount;
        grandTotalInstallment += totalInstPaid;
        grandTotalBalance += balance;
      }

      // ── Write Grand Total Row ──────────────────────────────────────────
      const grandRow = ws.getRow(currentRow);
      grandRow.getCell(1).value = 'Grand Total';
      grandRow.getCell(1).font = { bold: true, size: 11 };
      grandRow.getCell(4).value = grandTotalAmount;
      grandRow.getCell(4).numFmt = CURRENCY_FMT;
      grandRow.getCell(4).font = { bold: true, size: 11 };
      grandRow.getCell(5).value = grandTotalInstallment;
      grandRow.getCell(5).numFmt = CURRENCY_FMT;
      grandRow.getCell(5).font = { bold: true, size: 11 };
      grandRow.getCell(6).value = grandTotalBalance;
      grandRow.getCell(6).numFmt = CURRENCY_FMT;
      grandRow.getCell(6).font = { bold: true, size: 11 };
      for (let c = 1; c <= 6; c++) {
        grandRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${GRAND_BG}` } };
        grandRow.getCell(c).border = thinBorder();
        grandRow.getCell(c).alignment = { horizontal: c >= 4 ? 'right' : 'left', vertical: 'middle' };
      }
      grandRow.height = 22;
      grandRow.commit();
      currentRow++;

      // ── Empty row after grand total ────────────────────────────────────
      const emptyRow3 = ws.getRow(currentRow);
      emptyRow3.commit();
      currentRow++;

      // ── Write each employee section ────────────────────────────────────
      let processed = 0;
      const total = sections.length;

      for (const section of sections) {
        // Employee name header row
        const empNameRow = ws.getRow(currentRow);
        empNameRow.getCell(1).value = section.empDisplayName;
        empNameRow.getCell(1).font = { bold: true, size: 11, color: { argb: `FF${HEADER_BG}` } };
        for (let c = 1; c <= 6; c++) {
          empNameRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${EMP_NAME_BG}` } };
          empNameRow.getCell(c).border = thinBorder();
        }
        empNameRow.height = 20;
        ws.mergeCells(currentRow, 1, currentRow, 6);
        empNameRow.commit();
        currentRow++;

        // Monthly rows
        for (const row of section.rows) {
          const dataRow = ws.getRow(currentRow);
          dataRow.getCell(1).value = row.monthLabel;
          dataRow.getCell(1).font = { size: 10 };
          dataRow.getCell(1).alignment = { horizontal: 'left' };

          dataRow.getCell(2).value = row.voucherNo || '';
          dataRow.getCell(2).font = { size: 10 };
          dataRow.getCell(2).alignment = { horizontal: 'center' };

          dataRow.getCell(3).value = row.voucherDate || '';
          dataRow.getCell(3).font = { size: 10 };
          dataRow.getCell(3).alignment = { horizontal: 'center' };

          if (row.amount !== null && row.amount > 0) {
            dataRow.getCell(4).value = row.amount;
            dataRow.getCell(4).numFmt = CURRENCY_FMT;
          }
          dataRow.getCell(4).font = { size: 10 };
          dataRow.getCell(4).alignment = { horizontal: 'right' };

          if (row.installment !== null && row.installment > 0) {
            dataRow.getCell(5).value = row.installment;
            dataRow.getCell(5).numFmt = CURRENCY_FMT;
          }
          dataRow.getCell(5).font = { size: 10 };
          dataRow.getCell(5).alignment = { horizontal: 'right' };

          dataRow.getCell(6).value = row.balance;
          dataRow.getCell(6).numFmt = CURRENCY_FMT;
          dataRow.getCell(6).font = { size: 10 };
          dataRow.getCell(6).alignment = { horizontal: 'right' };

          for (let c = 1; c <= 6; c++) {
            dataRow.getCell(c).border = thinBorder();
          }

          dataRow.height = 16;
          dataRow.commit();
          currentRow++;
        }

        // Subtotal row
        const subRow = ws.getRow(currentRow);
        subRow.getCell(4).value = section.totalAmount;
        subRow.getCell(4).numFmt = CURRENCY_FMT;
        subRow.getCell(4).font = { bold: true, size: 10 };
        subRow.getCell(4).alignment = { horizontal: 'right' };

        subRow.getCell(5).value = section.totalInstallment;
        subRow.getCell(5).numFmt = CURRENCY_FMT;
        subRow.getCell(5).font = { bold: true, size: 10 };
        subRow.getCell(5).alignment = { horizontal: 'right' };

        subRow.getCell(6).value = section.finalBalance;
        subRow.getCell(6).numFmt = CURRENCY_FMT;
        subRow.getCell(6).font = { bold: true, size: 10 };
        subRow.getCell(6).alignment = { horizontal: 'right' };

        for (let c = 1; c <= 6; c++) {
          subRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SUBTOTAL_BG}` } };
          subRow.getCell(c).border = thinBorder();
        }
        subRow.height = 18;
        subRow.commit();
        currentRow++;

        // Empty separator row
        const sepRow = ws.getRow(currentRow);
        sepRow.commit();
        currentRow++;

        processed++;
        const pct = total > 0 ? Math.round((processed / total) * 90) : 50;
        await job.progress(pct);
        await new Promise((r) => setImmediate(r));
      }

      // ── Finalize ───────────────────────────────────────────────────────
      await workbook.commit();

      // Upload to S3/CDN and update export history
      await this.exportHistoryService.completeAndUploadExport(
        prisma,
        jobId,
        filePath,
        `employee-loan-account-${new Date().toISOString().slice(0, 10)}.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      await job.progress(100);

      this.logger.log(`[LoanRequestExport ${jobId}] Finished (${sections.length} employees)`);

      await this.notificationsService.create({
        userId,
        title: 'Loan Account Export Ready',
        message: `Your Employee Loan Account export for ${sections.length} employee${sections.length !== 1 ? 's' : ''} is ready to download.`,
        category: 'export',
        priority: 'high',
        actionType: 'loan-request-export.ready',
        actionPayload: JSON.stringify({ jobId }),
        entityType: 'loan-request-export',
        entityId: jobId,
        channels: ['inApp'],
      });

    } catch (error: any) {
      this.logger.error(`[LoanRequestExport ${jobId}] FAILED: ${error.message}`, error.stack);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (_err) {}
      }

      await this.exportHistoryService.failExport(prisma, jobId);

      await this.notificationsService.create({
        userId,
        title: 'Loan Account Export Failed',
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
