import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../database/prisma.service';
import { ReportsService } from './reports.service';
import { NotificationsService } from '../../notifications/notifications.service';

export interface TrialBalanceExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  from?: string;
  to?: string;
  includeTagAccounts?: boolean;
  reportType?: 'OPENING' | 'CLOSING' | 'DETAILED';
}

const SUBHEADER_BG = '334155';
const SUBHEADER_FG = 'F1F5F9';
const ALT_ROW_BG   = 'F8FAFC';
const BORDER_COLOR = 'CBD5E1';

const GROUP_COLORS: Record<string, string> = {
  'Identity':        '1E3A5F',
  'Opening Balance': '1E4D2B',
  'Transactions':    '4A1942',
  'Closing Balance': '7C3A00',
};

@Processor('trial-balance-export')
export class TrialBalanceExportProcessor {
  private readonly logger = new Logger(TrialBalanceExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
  ) {}

  @Process()
  async handleExport(job: Job<TrialBalanceExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, from, to, includeTagAccounts, reportType = 'DETAILED' } = job.data;

    this.logger.log(`[TrialBalanceExport ${jobId}] Starting export for user ${userId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
    const reportsService = new ReportsService(prisma);

    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const filePath = path.join(exportDir, `export-${jobId}.xlsx`);

    try {
      // 1. Fetch Trial Balance data dynamically using the standard ReportsService
      const result = await reportsService.getTrialBalance(from, to, !!includeTagAccounts);
      const rows = result.rows || [];

      // 2. Set up dynamic columns based on selected reportType
      const showOpening = reportType === 'OPENING' || reportType === 'DETAILED';
      const showTransactions = reportType === 'DETAILED';
      const showClosing = reportType === 'CLOSING' || reportType === 'DETAILED';

      const COLUMNS: {
        header: string;
        key: string;
        width: number;
        group: string;
        numFmt?: string;
        align?: ExcelJS.Alignment['horizontal'];
      }[] = [
        { header: 'Sr. No',      key: 'srNo',   width: 10, group: 'Identity', align: 'center' },
        { header: 'Acc. Code',   key: 'code',   width: 16, group: 'Identity', align: 'center' },
        { header: 'Account',     key: 'name',   width: 40, group: 'Identity', align: 'left' },
      ];

      if (showOpening) {
        COLUMNS.push({ header: 'DR', key: 'openingDebit',  width: 18, group: 'Opening Balance', numFmt: '#,##0.00', align: 'right' });
        COLUMNS.push({ header: 'CR', key: 'openingCredit', width: 18, group: 'Opening Balance', numFmt: '#,##0.00', align: 'right' });
      }
      if (showTransactions) {
        COLUMNS.push({ header: 'DR', key: 'transactionDebit',  width: 18, group: 'Transactions', numFmt: '#,##0.00', align: 'right' });
        COLUMNS.push({ header: 'CR', key: 'transactionCredit', width: 18, group: 'Transactions', numFmt: '#,##0.00', align: 'right' });
      }
      if (showClosing) {
        COLUMNS.push({ header: 'DR', key: 'closingDebit',  width: 18, group: 'Closing Balance', numFmt: '#,##0.00', align: 'right' });
        COLUMNS.push({ header: 'CR', key: 'closingCredit', width: 18, group: 'Closing Balance', numFmt: '#,##0.00', align: 'right' });
      }

      // 3. Initialize streaming Excel writer
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        filename: filePath,
        useStyles: true,
        useSharedStrings: false,
      });

      const ws = workbook.addWorksheet('Trial Balance', {
        pageSetup: { paperSize: 9, orientation: reportType === 'DETAILED' ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1 },
        views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }],
      });

      ws.columns = COLUMNS.map(c => ({ key: c.key, width: c.width }));

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

      // ── Data rows ────────────────────────────────────────────────────────
      let rowIdx = 0;
      for (const row of rows) {
        const isAlt = rowIdx % 2 === 1;
        const isGroup = row.isGroup;
        const isTag = row.isTagAccount;
        const level = row.level || 0;

        // Apply indentation for visual hierarchy in the excel cell
        const indentPrefix = ' '.repeat(level * 3);
        const nameVal = isTag ? `${indentPrefix}↳ ${row.name}` : `${indentPrefix}${row.name}`;

        const rowData: Record<string, any> = {
          srNo:              rowIdx + 1,
          code:              row.code,
          name:              nameVal,
          openingDebit:      row.openingDebit > 0 ? Number(row.openingDebit) : null,
          openingCredit:     row.openingCredit > 0 ? Number(row.openingCredit) : null,
          transactionDebit:  row.transactionDebit > 0 ? Number(row.transactionDebit) : null,
          transactionCredit: row.transactionCredit > 0 ? Number(row.transactionCredit) : null,
          closingDebit:      row.closingDebit > 0 ? Number(row.closingDebit) : null,
          closingCredit:     row.closingCredit > 0 ? Number(row.closingCredit) : null,
        };

        const dataRow = ws.getRow(rowIdx + 3);
        COLUMNS.forEach((col, colIdx) => {
          const cell = dataRow.getCell(colIdx + 1);
          cell.value = rowData[col.key];

          if (col.numFmt) cell.numFmt = col.numFmt;
          cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };

          // Styling
          const cellFill: ExcelJS.Fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: isGroup ? 'FFF1F5F9' : isTag ? 'FFF8FAFC' : isAlt ? ALT_ROW_BG : 'FFFFFFFF' },
          };
          cell.fill = cellFill;

          cell.font = {
            bold: isGroup,
            italic: isTag,
            size: 9,
            color: isTag ? { argb: 'FF64748B' } : undefined,
          };

          cell.border = {
            top:    { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
            left:   { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
            bottom: { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
            right:  { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
          };
        });

        dataRow.height = 18;
        dataRow.commit();
        rowIdx++;

        if (rowIdx % 100 === 0) {
          const pct = Math.round((rowIdx / rows.length) * 90);
          await job.progress(pct);
          await new Promise(r => setImmediate(r));
        }
      }

      // ── Grand Total row ──────────────────────────────────────────────────
      const totalRowIdx = rowIdx + 3;
      const totalRow = ws.getRow(totalRowIdx);

      const totalsData: Record<string, any> = {
        name:              'GRAND TOTAL',
        openingDebit:      result.totalOpeningDebit ? Number(result.totalOpeningDebit) : 0,
        openingCredit:     result.totalOpeningCredit ? Number(result.totalOpeningCredit) : 0,
        transactionDebit:  result.totalTransactionDebit ? Number(result.totalTransactionDebit) : 0,
        transactionCredit: result.totalTransactionCredit ? Number(result.totalTransactionCredit) : 0,
        closingDebit:      result.totalClosingDebit ? Number(result.totalClosingDebit) : 0,
        closingCredit:     result.totalClosingCredit ? Number(result.totalClosingCredit) : 0,
      };

      COLUMNS.forEach((col, colIdx) => {
        const cell = totalRow.getCell(colIdx + 1);
        if (col.key === 'name') {
          cell.value = totalsData.name;
        } else if (totalsData[col.key] !== undefined) {
          cell.value = totalsData[col.key];
        } else {
          cell.value = null;
        }

        if (col.numFmt) cell.numFmt = col.numFmt;
        cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };

        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE2E8F0' },
        };

        cell.font = {
          bold: true,
          size: 9,
          color: { argb: 'FF1E293B' },
        };

        // Standard accounting double underline at bottom border
        cell.border = {
          top:    { style: 'thin', color: { argb: 'FF000000' } },
          left:   { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
          bottom: { style: 'double', color: { argb: 'FF000000' } },
          right:  { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
        };
      });

      totalRow.height = 20;
      totalRow.commit();

      // ── Summary Sheet ───────────────────────────────────────────────────
      const summary = workbook.addWorksheet('Summary');
      summary.columns = [{ key: 'label', width: 28 }, { key: 'value', width: 25 }];

      const titleRow = summary.getRow(1);
      titleRow.getCell(1).value     = 'Trial Balance Summary';
      titleRow.getCell(1).font      = { bold: true, size: 14, color: { argb: 'FF1E293B' } };
      titleRow.getCell(1).fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      titleRow.height = 28;
      titleRow.commit();

      const summaryRows = [
        ['Export Date',          new Date().toLocaleString('en-PK')],
        ['Total Accounts Listed', rowIdx],
        ['Period From',          from ?? 'All time'],
        ['Period To',            to ?? 'All time'],
        ['Include Sub-Accounts', includeTagAccounts ? 'Yes' : 'No'],
        ['Report Format',        reportType],
        ['Books Balanced',       result.balanced ? 'Yes (✓)' : 'No (⚠)'],
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

      this.logger.log(`[TrialBalanceExport ${jobId}] Finished Excel export successfully`);

      // ── Push In-App Notification ──────────────────────────────────────────
      await this.notificationsService.create({
        userId,
        title: 'Trial Balance Export Ready',
        message: `Your Trial Balance Excel export is ready to download.`,
        category: 'export',
        priority: 'high',
        actionType: 'trial-balance-export.ready',
        actionPayload: { jobId },
        entityType: 'trial-balance-export',
        entityId: jobId,
        channels: ['inApp'],
      });

    } catch (error: any) {
      this.logger.error(`[TrialBalanceExport ${jobId}] FAILED: ${error.message}`, error.stack);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      await this.notificationsService.create({
        userId,
        title: 'Trial Balance Export Failed',
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
