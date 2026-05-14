import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

export interface SupplierExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  search?: string;
  status?: string; // 'active' | 'inactive'
  type?: string;   // 'LOCAL' | 'IMPORT'
}

// ── Colour palette ─────────────────────────────────────────────────────────────
const SUBHEADER_BG = '1E3A5F';
const SUBHEADER_FG = 'F1F5F9';
const ALT_ROW_BG   = 'F0F4F8';
const BORDER_COLOR = 'CBD5E1';
const ACTIVE_FG    = '15803D';
const INACTIVE_FG  = 'B91C1C';
const AMOUNT_FG    = '0F766E';

const GROUP_COLORS: Record<string, string> = {
  Identity:   '1E3A5F',
  Contact:    '1E4D2B',
  Tax:        '4A1942',
  Financial:  '1A3A4A',
  Audit:      '3D2B00',
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
  { header: 'Code',            key: 'code',            width: 14, group: 'Identity',  align: 'center' },
  { header: 'Name',            key: 'name',            width: 30, group: 'Identity' },
  { header: 'Brand',           key: 'brand',           width: 18, group: 'Identity' },
  { header: 'Nature',          key: 'nature',          width: 14, group: 'Identity' },
  { header: 'Type',            key: 'type',            width: 10, group: 'Identity',  align: 'center' },
  { header: 'Status',          key: 'status',          width: 10, group: 'Identity',  align: 'center' },
  // Contact
  { header: 'Address',         key: 'address',         width: 30, group: 'Contact' },
  { header: 'City',            key: 'city',            width: 16, group: 'Contact' },
  { header: 'Country',         key: 'country',         width: 16, group: 'Contact' },
  { header: 'Contact No',      key: 'contactNo',       width: 18, group: 'Contact' },
  { header: 'Email',           key: 'email',           width: 26, group: 'Contact' },
  { header: 'Website',         key: 'website',         width: 26, group: 'Contact' },
  // Tax
  { header: 'CNIC No',         key: 'cnicNo',          width: 18, group: 'Tax',       align: 'center' },
  { header: 'NTN No',          key: 'ntnNo',           width: 16, group: 'Tax',       align: 'center' },
  { header: 'STRN No',         key: 'strnNo',          width: 16, group: 'Tax',       align: 'center' },
  { header: 'SRB No',          key: 'srbNo',           width: 16, group: 'Tax',       align: 'center' },
  { header: 'PRA No',          key: 'praNo',           width: 16, group: 'Tax',       align: 'center' },
  { header: 'ICT No',          key: 'ictNo',           width: 16, group: 'Tax',       align: 'center' },
  // Financial
  { header: 'Payment Terms',   key: 'paymentTerms',    width: 18, group: 'Financial' },
  { header: 'Credit Limit',    key: 'creditLimit',     width: 16, group: 'Financial', numFmt: '#,##0.00', align: 'right' },
  { header: 'Opening Balance', key: 'openingBalance',  width: 18, group: 'Financial', numFmt: '#,##0.00', align: 'right' },
  { header: 'Current Balance', key: 'currentBalance',  width: 18, group: 'Financial', numFmt: '#,##0.00', align: 'right' },
  { header: 'Advance Balance', key: 'advanceBalance',  width: 18, group: 'Financial', numFmt: '#,##0.00', align: 'right' },
  // Audit
  { header: 'Created At',      key: 'createdAt',       width: 18, group: 'Audit',     numFmt: 'dd-mmm-yyyy hh:mm', align: 'center' },
  { header: 'Updated At',      key: 'updatedAt',       width: 18, group: 'Audit',     numFmt: 'dd-mmm-yyyy hh:mm', align: 'center' },
];

@Processor('supplier-export')
export class SupplierExportProcessor {
  private readonly logger = new Logger(SupplierExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
  ) {}

  @Process()
  async handleExport(job: Job<SupplierExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, search, status, type } = job.data;

    this.logger.log(`[SupplierExport ${jobId}] Starting for user ${userId}`);

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
            { name:      { contains: t, mode: 'insensitive' } },
            { code:      { contains: t, mode: 'insensitive' } },
            { email:     { contains: t, mode: 'insensitive' } },
            { contactNo: { contains: t, mode: 'insensitive' } },
            { ntnNo:     { contains: t, mode: 'insensitive' } },
            { cnicNo:    { contains: t, mode: 'insensitive' } },
          ],
        });
      }
      if (status === 'active')   andClauses.push({ isActive: true });
      if (status === 'inactive') andClauses.push({ isActive: false });
      if (type)                  andClauses.push({ type });
      const where: any = andClauses.length ? { AND: andClauses } : {};

      const total = await prisma.supplier.count({ where });
      this.logger.log(`[SupplierExport ${jobId}] ${total} rows to export`);

      // ── Streaming workbook writer ────────────────────────────────────────
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        filename: filePath,
        useStyles: true,
        useSharedStrings: false,
      });

      const ws = workbook.addWorksheet('Suppliers', {
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
        const chunk = await prisma.supplier.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: CHUNK,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });

        if (!chunk.length) break;

        for (const supplier of chunk) {
          const isAlt      = rowIdx % 2 === 1;
          const isInactive = !supplier.isActive;

          const rowData: Record<string, any> = {
            code:           supplier.code,
            name:           supplier.name,
            brand:          supplier.brand ?? '',
            nature:         supplier.nature ?? '',
            type:           supplier.type ?? '',
            status:         supplier.isActive ? 'Active' : 'Inactive',
            address:        supplier.address ?? '',
            city:           supplier.city ?? '',
            country:        supplier.country ?? '',
            contactNo:      supplier.contactNo ?? '',
            email:          supplier.email ?? '',
            website:        supplier.website ?? '',
            cnicNo:         supplier.cnicNo ?? '',
            ntnNo:          supplier.ntnNo ?? '',
            strnNo:         supplier.strnNo ?? '',
            srbNo:          supplier.srbNo ?? '',
            praNo:          supplier.praNo ?? '',
            ictNo:          supplier.ictNo ?? '',
            paymentTerms:   supplier.paymentTerms ?? '',
            creditLimit:    Number(supplier.creditLimit ?? 0),
            openingBalance: Number(supplier.openingBalance ?? 0),
            currentBalance: Number(supplier.currentBalance ?? 0),
            advanceBalance: Number(supplier.advanceBalance ?? 0),
            createdAt:      new Date(supplier.createdAt),
            updatedAt:      new Date(supplier.updatedAt),
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
            } else if (['creditLimit', 'openingBalance', 'currentBalance', 'advanceBalance'].includes(col.key)) {
              cell.font = { size: 9, color: { argb: `FF${AMOUNT_FG}` } };
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
      titleRow.getCell(1).value     = 'Supplier Export Summary';
      titleRow.getCell(1).font      = { bold: true, size: 14, color: { argb: 'FF1E293B' } };
      titleRow.getCell(1).fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      titleRow.height = 28;
      titleRow.commit();

      const summaryRows = [
        ['Export Date',    new Date().toLocaleString('en-PK')],
        ['Total Suppliers', rowIdx],
        ['Search Filter',  search ?? '(none)'],
        ['Status Filter',  status ?? '(all)'],
        ['Type Filter',    type ?? '(all)'],
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

      this.logger.log(`[SupplierExport ${jobId}] File written (${rowIdx} rows)`);

      await this.notificationsService.create({
        userId,
        title: 'Supplier Export Ready',
        message: `Your export of ${rowIdx.toLocaleString()} supplier${rowIdx !== 1 ? 's' : ''} is ready to download.`,
        category: 'export',
        priority: 'high',
        actionType: 'supplier-export.ready',
        actionPayload: { jobId },
        entityType: 'supplier-export',
        entityId: jobId,
        channels: ['inApp'],
      });

    } catch (error: any) {
      this.logger.error(`[SupplierExport ${jobId}] FAILED: ${error.message}`, error.stack);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      await this.notificationsService.create({
        userId,
        title: 'Supplier Export Failed',
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
