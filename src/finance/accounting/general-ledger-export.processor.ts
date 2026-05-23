import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../database/prisma.service';
import { ReportsService } from './reports.service';
import { NotificationsService } from '../../notifications/notifications.service';

export interface GeneralLedgerExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  accountId: string;
  from?: string;
  to?: string;
  sourceType?: string;
}

const SUBHEADER_BG = '475569';
const SUBHEADER_FG = 'F8FAFC';
const ALT_ROW_BG   = 'F8FAFC';
const BORDER_COLOR = 'CBD5E1';

const GROUP_COLORS: Record<string, string> = {
  'Identity': '1E3A5F', // Dark Navy
  'Details':  '334155', // Slate
  'Volume':   '1E4D2B', // Forest Green
  'Position': '7C3A00', // Bronze
};

const SOURCE_LABELS: Record<string, string> = {
  PURCHASE_INVOICE: 'Purchase Invoice',
  PAYMENT_VOUCHER: 'Payment Voucher',
  RECEIPT_VOUCHER: 'Receipt Voucher',
  JOURNAL_VOUCHER: 'Journal Voucher',
  ADVANCE_APPLICATION: 'Advance Application',
  SALES_INVOICE: 'Sales Invoice',
};

const COLUMNS: {
  header: string;
  key: string;
  width: number;
  group: string;
  numFmt?: string;
  align?: ExcelJS.Alignment['horizontal'];
}[] = [
  { header: 'Sr. No',      key: 'srNo',            width: 10, group: 'Identity', align: 'center' },
  { header: 'Date',        key: 'transactionDate', width: 14, group: 'Identity', numFmt: 'dd-mmm-yyyy', align: 'center' },
  { header: 'Reference',   key: 'sourceRef',       width: 20, group: 'Identity', align: 'center' },
  { header: 'Source Doc',  key: 'sourceType',      width: 20, group: 'Identity', align: 'center' },
  { header: 'Narration',   key: 'narration',       width: 42, group: 'Details',  align: 'left' },
  { header: 'Debit',       key: 'debit',           width: 18, group: 'Volume',   numFmt: '#,##0.00', align: 'right' },
  { header: 'Credit',      key: 'credit',          width: 18, group: 'Volume',   numFmt: '#,##0.00', align: 'right' },
  { header: 'Balance',     key: 'runningBalance',  width: 20, group: 'Position', numFmt: '#,##0.00', align: 'right' },
];

@Processor('general-ledger-export')
export class GeneralLedgerExportProcessor {
  private readonly logger = new Logger(GeneralLedgerExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
  ) {}

  @Process()
  async handleExport(job: Job<GeneralLedgerExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, accountId, from, to, sourceType } = job.data;

    this.logger.log(`[GeneralLedgerExport ${jobId}] Starting general ledger export for user ${userId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
    const reportsService = new ReportsService(prisma);

    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const filePath = path.join(exportDir, `export-${jobId}.xlsx`);

    try {
      // 1. Fetch general ledger data using ReportsService (with safe limit)
      const result = await reportsService.getGeneralLedger(
        accountId,
        from,
        to,
        1,
        1000000,
        sourceType === 'all' ? undefined : sourceType,
      );
      const rows = result.rows || [];
      const account = result.account;
      const isDebitNormal = account.type === 'ASSET' || account.type === 'EXPENSE';

      // 2. Initialize streaming Excel writer
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        filename: filePath,
        useStyles: true,
        useSharedStrings: false,
      });

      const ws = workbook.addWorksheet('General Ledger', {
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
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

      // ── Row 3: Opening Balance Row ───────────────────────────────────────
      const opRow = ws.getRow(3);
      opRow.getCell(1).value = '';
      opRow.getCell(2).value = '';
      opRow.getCell(3).value = '—';
      opRow.getCell(4).value = 'Opening Balance';
      opRow.getCell(5).value = 'Balance brought forward';
      opRow.getCell(6).value = null;
      opRow.getCell(7).value = null;
      opRow.getCell(8).value = result.openingBalance;
      opRow.getCell(8).numFmt = '#,##0.00';
      opRow.getCell(8).alignment = { horizontal: 'right', vertical: 'middle' };
      opRow.getCell(8).font = { bold: true, size: 9 };

      for (let c = 1; c <= 8; c++) {
        const cell = opRow.getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        cell.border = {
          top:    { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
          left:   { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
          bottom: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
          right:  { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
        };
      }
      opRow.height = 18;
      opRow.commit();

      // ── Data rows ────────────────────────────────────────────────────────
      let rowIdx = 0;
      for (const row of rows) {
        const isAlt = rowIdx % 2 === 1;
        const rowData = {
          srNo:            rowIdx + 1,
          transactionDate: row.transactionDate ? new Date(row.transactionDate) : null,
          sourceRef:       row.sourceRef,
          sourceType:      SOURCE_LABELS[row.sourceType] ?? row.sourceType,
          narration:       row.narration || row.description || '—',
          debit:           row.debit > 0 ? Number(row.debit) : null,
          credit:          row.credit > 0 ? Number(row.credit) : null,
          runningBalance:  Number(row.runningBalance),
        };

        const dataRow = ws.getRow(rowIdx + 4);
        COLUMNS.forEach((col, colIdx) => {
          const cell = dataRow.getCell(colIdx + 1);
          cell.value = rowData[col.key];

          if (col.numFmt) cell.numFmt = col.numFmt;
          cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };

          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: isAlt ? ALT_ROW_BG : 'FFFFFFFF' },
          };

          cell.font = { size: 9 };
          if (col.key === 'runningBalance') {
            cell.font = {
              bold: true,
              size: 9,
              color: row.runningBalance >= 0 ? { argb: 'FF065F46' } : { argb: 'FF991B1B' }
            };
          }

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

      // ── Total Row ────────────────────────────────────────────────────────
      const totalRowIdx = rowIdx + 4;
      const totalRow = ws.getRow(totalRowIdx);

      const totalsData: Record<string, any> = {
        sourceType:      'CLOSING TOTALS',
        debit:           Number(result.rangeTotalDebit),
        credit:          Number(result.rangeTotalCredit),
        runningBalance:  Number(result.rangeClosingBalance),
      };

      COLUMNS.forEach((col, colIdx) => {
        const cell = totalRow.getCell(colIdx + 1);
        if (col.key === 'sourceType') {
          cell.value = totalsData.sourceType;
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
      titleRow.getCell(1).value     = 'General Ledger Summary';
      titleRow.getCell(1).font      = { bold: true, size: 14, color: { argb: 'FF1E293B' } };
      titleRow.getCell(1).fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      titleRow.height = 28;
      titleRow.commit();

      const summaryRows = [
        ['Export Date',          new Date().toLocaleString('en-PK')],
        ['Account Code',         account.code],
        ['Account Name',         account.name],
        ['Account Type',         account.type],
        ['Total Transactions',   rowIdx],
        ['Period From',          from ?? 'All time'],
        ['Period To',            to ?? 'All time'],
        ['Document Type Filter', sourceType ?? 'All'],
        ['Normal Balance Type',  isDebitNormal ? 'Debit (Dr) Normal' : 'Credit (Cr) Normal'],
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

      this.logger.log(`[GeneralLedgerExport ${jobId}] Finished Excel export successfully`);

      // ── Push In-App Notification ──────────────────────────────────────────
      await this.notificationsService.create({
        userId,
        title: 'General Ledger Export Ready',
        message: `Your General Ledger Excel export for ${account.code} is ready.`,
        category: 'export',
        priority: 'high',
        actionType: 'general-ledger-export.ready',
        actionPayload: { jobId },
        entityType: 'general-ledger-export',
        entityId: jobId,
        channels: ['inApp'],
      });

    } catch (error: any) {
      this.logger.error(`[GeneralLedgerExport ${jobId}] FAILED: ${error.message}`, error.stack);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      await this.notificationsService.create({
        userId,
        title: 'General Ledger Export Failed',
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
