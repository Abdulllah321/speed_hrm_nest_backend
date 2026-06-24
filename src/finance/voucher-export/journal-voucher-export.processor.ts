import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

export interface JvExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

// ── Colour palette ────────────────────────────────────────────────────────────
const SUBHEADER_BG = '1E3A5F';
const SUBHEADER_FG = 'F1F5F9';
const ALT_ROW_BG   = 'F0F4F8';
const BORDER_COLOR = 'CBD5E1';

const GROUP_COLORS: Record<string, string> = {
  Voucher: '1A3A5C',
  Detail:  '1E4D2B',
  Amounts: '7C3A00',
};

const COLUMNS: {
  header: string;
  key: string;
  width: number;
  group: string;
  numFmt?: string;
  align?: ExcelJS.Alignment['horizontal'];
}[] = [
  // Voucher
  { header: 'JV No',        key: 'jvNo',           width: 18, group: 'Voucher', align: 'center' },
  { header: 'JV Date',      key: 'jvDate',         width: 14, group: 'Voucher', numFmt: 'dd-mmm-yyyy', align: 'center' },
  { header: 'Folio',        key: 'folio',          width: 10, group: 'Voucher', align: 'center' },
  { header: 'Status',       key: 'status',         width: 11, group: 'Voucher', align: 'center' },
  { header: 'Description',  key: 'description',    width: 36, group: 'Voucher' },
  // Detail
  { header: 'Line #',       key: 'lineNo',         width: 8,  group: 'Detail',  align: 'center' },
  { header: 'Account Code', key: 'accountCode',    width: 16, group: 'Detail',  align: 'center' },
  { header: 'Account Name', key: 'accountName',    width: 30, group: 'Detail' },
  { header: 'Tag Account',  key: 'tagAccountName', width: 24, group: 'Detail' },
  { header: 'Narration',    key: 'narration',      width: 34, group: 'Detail' },
  { header: 'Ref Bill No',  key: 'refBillNo',      width: 18, group: 'Detail' },
  { header: 'Tax Type',     key: 'taxType',        width: 12, group: 'Detail',  align: 'center' },
  // Amounts
  { header: 'Debit',        key: 'debit',          width: 16, group: 'Amounts', numFmt: '#,##0.00', align: 'right' },
  { header: 'Credit',       key: 'credit',         width: 16, group: 'Amounts', numFmt: '#,##0.00', align: 'right' },
];

@Processor('journal-voucher-export')
export class JournalVoucherExportProcessor {
  private readonly logger = new Logger(JournalVoucherExportProcessor.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @Process()
  async handleExport(job: Job<JvExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, status, dateFrom, dateTo } = job.data;

    this.logger.log(`[JvExport ${jobId}] Starting for user ${userId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const filePath = path.join(exportDir, `export-${jobId}.xlsx`);

    try {
      // ── Build WHERE ────────────────────────────────────────────────────────
      const andClauses: any[] = [];
      if (status && status !== 'all') andClauses.push({ status });
      if (dateFrom || dateTo) {
        const dateFilter: any = {};
        if (dateFrom) dateFilter.gte = new Date(dateFrom);
        if (dateTo)   dateFilter.lte = new Date(new Date(dateTo).setHours(23, 59, 59, 999));
        andClauses.push({ jvDate: dateFilter });
      }
      const where: any = andClauses.length ? { AND: andClauses } : {};

      const total = await prisma.journalVoucher.count({ where });
      this.logger.log(`[JvExport ${jobId}] ${total} vouchers to export`);

      // ── Streaming workbook ─────────────────────────────────────────────────
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        filename: filePath,
        useStyles: true,
        useSharedStrings: false,
      });

      const ws = workbook.addWorksheet('Journal Vouchers', {
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
        views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }],
      });

      ws.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));

      // ── Row 1: Group header bands ──────────────────────────────────────────
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

      // ── Row 2: Column headers ──────────────────────────────────────────────
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

      // ── Data rows — cursor-paginated in chunks of 500 ──────────────────────
      const CHUNK = 500;
      let cursor: string | undefined;
      let rowIdx = 0;
      let processedVouchers = 0;

      while (true) {
        const chunk = await prisma.journalVoucher.findMany({
          where,
          orderBy: { jvDate: 'desc' },
          take: CHUNK,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          include: {
            details: {
              include: {
                account:    { select: { code: true, name: true } },
                tagAccount: { select: { code: true, name: true } },
              },
            },
          },
        });

        if (!chunk.length) break;

        for (const jv of chunk) {
          const details = jv.details.length > 0 ? jv.details : [null];

          details.forEach((detail: any, dIdx: number) => {
            const isAlt = rowIdx % 2 === 1;
            const isApproved = jv.status === 'approved';

            const rowData: Record<string, any> = {
              jvNo:           dIdx === 0 ? jv.jvNo : '',
              jvDate:         dIdx === 0 ? new Date(jv.jvDate) : null,
              folio:          dIdx === 0 ? (jv.folio ?? '') : '',
              status:         dIdx === 0 ? jv.status.toUpperCase() : '',
              description:    dIdx === 0 ? (jv.description ?? '') : '',
              lineNo:         detail ? dIdx + 1 : '',
              accountCode:    detail?.account?.code    ?? '',
              accountName:    detail?.account?.name    ?? '',
              tagAccountName: detail?.tagAccount?.name ?? '',
              narration:      detail?.narration        ?? '',
              refBillNo:      detail?.refBillNo        ?? '',
              taxType:        detail?.taxType          ?? '',
              debit:          detail ? Number(detail.debit)  : null,
              credit:         detail ? Number(detail.credit) : null,
            };

            const dataRow = ws.getRow(rowIdx + 3);
            COLUMNS.forEach((col, colIdx) => {
              const cell = dataRow.getCell(colIdx + 1);
              cell.value     = rowData[col.key] ?? null;
              if (col.numFmt && rowData[col.key] !== null && rowData[col.key] !== '')
                cell.numFmt = col.numFmt;
              cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
              cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${isAlt ? ALT_ROW_BG : 'FFFFFF'}` } };

              if (col.key === 'status') {
                cell.font = { bold: true, size: 9, color: { argb: isApproved ? 'FF15803D' : 'FFB45309' } };
              } else if (col.key === 'debit') {
                cell.font = { size: 9, color: { argb: 'FF1D4ED8' } };
              } else if (col.key === 'credit') {
                cell.font = { size: 9, color: { argb: 'FF15803D' } };
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
          });
        }

        processedVouchers += chunk.length;
        cursor = chunk[chunk.length - 1].id;

        const pct = total > 0 ? Math.round((processedVouchers / total) * 95) : 50;
        await job.progress(pct);
        await new Promise((r) => setImmediate(r));

        if (chunk.length < CHUNK) break;
      }

      // ── Summary sheet ──────────────────────────────────────────────────────
      const summary = workbook.addWorksheet('Summary');
      summary.columns = [{ key: 'label', width: 28 }, { key: 'value', width: 24 }];
      const titleRow = summary.getRow(1);
      titleRow.getCell(1).value     = 'Journal Voucher Export Summary';
      titleRow.getCell(1).font      = { bold: true, size: 14, color: { argb: 'FF1E293B' } };
      titleRow.getCell(1).fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      titleRow.height = 28;
      titleRow.commit();

      const summaryRows = [
        ['Export Date',    new Date().toLocaleString('en-PK')],
        ['Total Vouchers', processedVouchers],
        ['Total Rows',     rowIdx],
        ['Status Filter',  status ?? '(all)'],
        ['Date From',      dateFrom ?? '(all)'],
        ['Date To',        dateTo   ?? '(all)'],
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

      this.logger.log(`[JvExport ${jobId}] File written (${processedVouchers} vouchers, ${rowIdx} rows)`);

      await this.notificationsService.create({
        userId,
        title: 'Journal Voucher Export Ready',
        message: `Your export of ${processedVouchers.toLocaleString()} journal voucher${processedVouchers !== 1 ? 's' : ''} is ready to download.`,
        category: 'export',
        priority: 'high',
        actionType: 'journal-voucher-export.ready',
        actionPayload: { jobId },
        entityType: 'journal-voucher-export',
        entityId: jobId,
        channels: ['inApp'],
      });

    } catch (error: any) {
      this.logger.error(`[JvExport ${jobId}] FAILED: ${error.message}`, error.stack);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      await this.notificationsService.create({
        userId,
        title: 'Journal Voucher Export Failed',
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
