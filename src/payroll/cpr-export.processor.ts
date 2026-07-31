import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ExportHistoryService } from '../warehouse/export-history/export-history.service';

export interface CprTaxExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  search?: string;
  month?: string;
  year?: string;
  months?: string;
}

// ── Colour palette ─────────────────────────────────────────────────────────────
const SUBHEADER_BG = '1E3A5F';
const SUBHEADER_FG = 'F1F5F9';
const ALT_ROW_BG   = 'F0F4F8';
const BORDER_COLOR = 'CBD5E1';
const VALUE_FG      = '0F766E';

const GROUP_COLORS: Record<string, string> = {
  Identity:  '1E3A5F',
  Financial: '1A3A4A',
  Period:    '1E4D2B',
  Contact:   '4A1942',
};

const COLUMNS: {
  header: string;
  key: string;
  width: number;
  group: string;
  numFmt?: string;
  align?: ExcelJS.Alignment['horizontal'];
}[] = [
  { header: 'S.No',                     key: 'sNo',                 width: 8,   group: 'Identity',  align: 'center' },
  { header: 'Employee ID',              key: 'employeeCode',        width: 14,  group: 'Identity',  align: 'center' },
  { header: 'Employee Name',            key: 'employeeName',        width: 25,  group: 'Identity' },
  { header: 'Taxpayer Name',            key: 'name',                width: 25,  group: 'Identity' },
  { header: 'Taxpayer CNIC',            key: 'cnic',                width: 18,  group: 'Identity',  align: 'center' },
  { header: 'CPR Number',               key: 'cprNo',               width: 20,  group: 'Identity',  align: 'center' },
  { header: 'Car Amount',               key: 'carAmount',           width: 15,  group: 'Financial', numFmt: '#,##0.00', align: 'right' },
  { header: 'Taxable Amount Annual',    key: 'taxableAmountAnnual', width: 22,  group: 'Financial', numFmt: '#,##0.00', align: 'right' },
  { header: 'Taxable Amount Gross',     key: 'taxableAmountGross',  width: 22,  group: 'Financial', numFmt: '#,##0.00', align: 'right' },
  { header: 'Annual Tax Amount',        key: 'taxAmountAnnual',     width: 18,  group: 'Financial', numFmt: '#,##0.00', align: 'right' },
  { header: 'Monthly Tax Amount',       key: 'taxAmountMonthlyTax', width: 18,  group: 'Financial', numFmt: '#,##0.00', align: 'right' },
  { header: 'Tax Period',               key: 'taxPeriod',           width: 12,  group: 'Period',    align: 'center' },
  { header: 'Payment Date',             key: 'paymentDate',         width: 15,  group: 'Period',    numFmt: 'dd-mmm-yyyy', align: 'center' },
  { header: 'City',                     key: 'city',                width: 15,  group: 'Contact' },
  { header: 'NTN',                      key: 'ntn',                 width: 15,  group: 'Contact',   align: 'center' },
];

@Processor('cpr-tax-export')
export class CprTaxExportProcessor {
  private readonly logger = new Logger(CprTaxExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly exportHistoryService: ExportHistoryService,
  ) {}

  @Process()
  async handleExport(job: Job<CprTaxExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, search, month, year, months } = job.data;

    this.logger.log(`[CprTaxExport ${jobId}] Starting for user ${userId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const filePath = path.join(exportDir, `export-${jobId}.xlsx`);

    try {
      // ── Build WHERE ──────────────────────────────────────────────────────
      const andClauses: any[] = [];

      // Filter by period
      let periods: string[] = [];
      if (months) {
        periods = months.split(',').map((m) => m.trim()).filter(Boolean);
      } else if (month && year && month !== 'all' && year !== 'all') {
        const monthStr = String(Number(month)).padStart(2, '0');
        const yearStr = String(year);
        periods = [`${yearStr}-${monthStr}`];
      }

      if (periods.length > 0) {
        andClauses.push({ taxPeriod: { in: periods } });
      }

      // Filter by search
      if (search) {
        const t = search.trim();
        andClauses.push({
          OR: [
            { name:  { contains: t, mode: 'insensitive' } },
            { cnic:  { contains: t, mode: 'insensitive' } },
            { cprNo: { contains: t, mode: 'insensitive' } },
            { city:  { contains: t, mode: 'insensitive' } },
            { ntn:   { contains: t, mode: 'insensitive' } },
            {
              employee: {
                OR: [
                  { employeeName: { contains: t, mode: 'insensitive' } },
                  { employeeId:   { contains: t, mode: 'insensitive' } },
                ],
              },
            },
          ],
        });
      }

      const where: any = andClauses.length ? { AND: andClauses } : {};

      const total = await prisma.cprTax.count({ where });
      this.logger.log(`[CprTaxExport ${jobId}] ${total} rows to export`);

      // ── Streaming workbook writer ────────────────────────────────────────
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        filename: filePath,
        useStyles: true,
        useSharedStrings: false,
      });

      const ws = workbook.addWorksheet('CPR Tax Records', {
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
        const cellVal = col.header;
        cell.value     = cellVal;
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

      // ── Data rows — paginated in chunks of 500 ────────────────────
      const CHUNK = 500;
      let rowIdx = 0;
      let processed = 0;

      while (true) {
        const chunk = await prisma.cprTax.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: CHUNK,
          skip: processed,
          include: {
            employee: {
              select: {
                id: true,
                employeeId: true,
                employeeName: true,
              },
            },
          },
        });

        if (!chunk.length) break;

        for (const record of chunk) {
          const isAlt = rowIdx % 2 === 1;

          const rowData: Record<string, any> = {
            sNo:                 rowIdx + 1,
            employeeCode:        record.employee?.employeeId ?? '—',
            employeeName:        record.employee?.employeeName ?? '—',
            name:                record.name,
            cnic:                record.cnic,
            cprNo:               record.cprNo,
            carAmount:           record.carAmount !== null ? Number(record.carAmount) : null,
            taxableAmountAnnual: record.taxableAmountAnnual !== null ? Number(record.taxableAmountAnnual) : null,
            taxableAmountGross:  record.taxableAmountGross !== null ? Number(record.taxableAmountGross) : null,
            taxAmountAnnual:     record.taxAmountAnnual !== null ? Number(record.taxAmountAnnual) : null,
            taxAmountMonthlyTax: record.taxAmountMonthlyTax !== null ? Number(record.taxAmountMonthlyTax) : null,
            taxPeriod:           record.taxPeriod,
            paymentDate:         record.paymentDate ? new Date(record.paymentDate) : null,
            city:                record.city ?? '—',
            ntn:                 record.ntn ?? '—',
          };

          const dataRow = ws.getRow(rowIdx + 3);
          COLUMNS.forEach((col, colIdx) => {
            const cell = dataRow.getCell(colIdx + 1);
            cell.value     = rowData[col.key] ?? null;
            if (col.numFmt) cell.numFmt = col.numFmt;
            cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
            cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${isAlt ? ALT_ROW_BG : 'FFFFFF'}` } };
            cell.font      = { size: 9 };
            cell.border    = {
              top:    { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
              left:   { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
              bottom: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
              right:  { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
            };

            if (['carAmount', 'taxableAmountAnnual', 'taxableAmountGross', 'taxAmountAnnual', 'taxAmountMonthlyTax'].includes(col.key)) {
              cell.font = { size: 9, color: { argb: `FF${VALUE_FG}` } };
            }
          });
          dataRow.height = 20;
          dataRow.commit();
          rowIdx++;
        }

        processed += chunk.length;
        // Report progress back to Bull
        const pct = Math.round((processed / total) * 100);
        await job.progress(pct);
      }

      await workbook.commit();

      // Upload to S3/CDN and update export history
      await this.exportHistoryService.completeAndUploadExport(
        prisma,
        jobId,
        filePath,
        `cpr-taxes-export-${new Date().toISOString().slice(0, 10)}.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      await job.progress(100);

      this.logger.log(`[CprTaxExport ${jobId}] Finished processing successfully (${rowIdx} rows)`);

      await this.notificationsService.create({
        userId,
        title: 'CPR Tax Export Ready',
        message: `Your export of ${rowIdx.toLocaleString()} CPR Tax record${rowIdx !== 1 ? 's' : ''} is ready to download.`,
        category: 'export',
        priority: 'high',
        actionType: 'cpr-tax-export.ready',
        actionPayload: JSON.stringify({ jobId }),
        entityType: 'cpr-tax-export',
        entityId: jobId,
        channels: ['inApp'],
      });

    } catch (error: any) {
      this.logger.error(`[CprTaxExport ${jobId}] Failed: ${error.message}`, error.stack);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {}
      }

      await this.exportHistoryService.failExport(prisma, jobId);

      await this.notificationsService.create({
        userId,
        title: 'CPR Tax Export Failed',
        message: `Export could not be completed: ${error.message}`,
        category: 'export',
        priority: 'urgent',
        channels: ['inApp'],
      });

      throw error;
    } finally {
      await prisma.$disconnect();
    }
  }
}
