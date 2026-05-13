import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

export interface ItemExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  brandIds?: string[];
  categoryIds?: string[];
  silhouetteIds?: string[];
  genderIds?: string[];
}

// ── Colour palette ─────────────────────────────────────────────────────────────
const SUBHEADER_BG = '334155';
const SUBHEADER_FG = 'F1F5F9';
const ALT_ROW_BG   = 'F8FAFC';
const BORDER_COLOR = 'CBD5E1';
const CURRENCY_FG  = '0F766E';
const ACTIVE_FG    = '15803D';
const INACTIVE_FG  = 'B91C1C';
const DISCOUNT_BG  = 'FEF9C3';

const GROUP_COLORS: Record<string, string> = {
  Identity:       '1E3A5F',
  Classification: '1E4D2B',
  Pricing:        '4A1942',
  Discounts:      '7C3A00',
  Attributes:     '1A3A4A',
  Audit:          '3D2B00',
};

const COLUMNS: {
  header: string;
  key: string;
  width: number;
  group: string;
  numFmt?: string;
  align?: ExcelJS.Alignment['horizontal'];
}[] = [
  { header: 'Item ID',       key: 'itemId',            width: 12, group: 'Identity',       align: 'center' },
  { header: 'SKU',           key: 'sku',               width: 20, group: 'Identity' },
  { header: 'Barcode',       key: 'barCode',           width: 18, group: 'Identity' },
  { header: 'Description',   key: 'description',       width: 40, group: 'Identity' },
  { header: 'Status',        key: 'status',            width: 10, group: 'Identity',        align: 'center' },
  { header: 'Brand',         key: 'brand',             width: 16, group: 'Classification' },
  { header: 'Division',      key: 'division',          width: 16, group: 'Classification' },
  { header: 'Category',      key: 'category',          width: 18, group: 'Classification' },
  { header: 'Sub-Category',  key: 'subCategory',       width: 18, group: 'Classification' },
  { header: 'Gender',        key: 'gender',            width: 12, group: 'Classification' },
  { header: 'Season',        key: 'season',            width: 14, group: 'Classification' },
  { header: 'Silhouette',    key: 'silhouette',        width: 16, group: 'Classification' },
  { header: 'Channel Class', key: 'channelClass',      width: 16, group: 'Classification' },
  { header: 'Item Class',    key: 'itemClass',         width: 16, group: 'Classification' },
  { header: 'Item Subclass', key: 'itemSubclass',      width: 16, group: 'Classification' },
  { header: 'Color',         key: 'color',             width: 14, group: 'Classification' },
  { header: 'Size',          key: 'size',              width: 10, group: 'Classification' },
  { header: 'Unit Price',    key: 'unitPrice',         width: 14, group: 'Pricing',         numFmt: '#,##0.00', align: 'right' },
  { header: 'Unit Cost',     key: 'unitCost',          width: 14, group: 'Pricing',         numFmt: '#,##0.00', align: 'right' },
  { header: 'FOB',           key: 'fob',               width: 14, group: 'Pricing',         numFmt: '#,##0.00', align: 'right' },
  { header: 'Tax Rate 1 %',  key: 'taxRate1',          width: 13, group: 'Pricing',         numFmt: '0.00"%"',  align: 'right' },
  { header: 'Tax Rate 2 %',  key: 'taxRate2',          width: 13, group: 'Pricing',         numFmt: '0.00"%"',  align: 'right' },
  { header: 'Discount %',    key: 'discountRate',      width: 13, group: 'Discounts',       numFmt: '0.00"%"',  align: 'right' },
  { header: 'Discount Amt',  key: 'discountAmount',    width: 14, group: 'Discounts',       numFmt: '#,##0.00', align: 'right' },
  { header: 'Disc. Start',   key: 'discountStartDate', width: 14, group: 'Discounts',       numFmt: 'dd-mmm-yyyy', align: 'center' },
  { header: 'Disc. End',     key: 'discountEndDate',   width: 14, group: 'Discounts',       numFmt: 'dd-mmm-yyyy', align: 'center' },
  { header: 'HS Code',       key: 'hsCode',            width: 16, group: 'Attributes' },
  { header: 'UOM',           key: 'uom',               width: 10, group: 'Attributes',      align: 'center' },
  { header: 'Currency',      key: 'currency',          width: 10, group: 'Attributes',      align: 'center' },
  { header: 'Case',          key: 'case',              width: 12, group: 'Attributes' },
  { header: 'Band',          key: 'band',              width: 12, group: 'Attributes' },
  { header: 'Movement Type', key: 'movementType',      width: 16, group: 'Attributes' },
  { header: 'Movement Name', key: 'movementName',      width: 16, group: 'Attributes' },
  { header: 'Heel Height',   key: 'heelHeight',        width: 12, group: 'Attributes' },
  { header: 'Width',         key: 'width',             width: 10, group: 'Attributes' },
  { header: 'Launch Date',   key: 'launchDate',        width: 14, group: 'Attributes',      numFmt: 'dd-mmm-yyyy', align: 'center' },
  { header: 'Old Season',    key: 'oldSeason',         width: 14, group: 'Attributes' },
  { header: 'Created At',    key: 'createdAt',         width: 18, group: 'Audit',           numFmt: 'dd-mmm-yyyy hh:mm', align: 'center' },
  { header: 'Updated At',    key: 'updatedAt',         width: 18, group: 'Audit',           numFmt: 'dd-mmm-yyyy hh:mm', align: 'center' },
];

const includeMasterData = {
  brand: true, division: true, category: true, subCategory: true,
  season: true, gender: true, size: true, silhouette: true,
  channelClass: true, color: true, itemClass: true, itemSubclass: true,
  hsCode: true,
};

@Processor('item-export')
export class ItemExportProcessor {
  private readonly logger = new Logger(ItemExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
  ) {}

  @Process()
  async handleExport(job: Job<ItemExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, search, sortBy, sortOrder, brandIds, categoryIds, silhouetteIds, genderIds } = job.data;

    this.logger.log(`[Export ${jobId}] Starting for user ${userId}`);

    // Each export job gets its own PrismaService scoped to the tenant DB
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
            { itemId:      { contains: t, mode: 'insensitive' } },
            { sku:         { contains: t, mode: 'insensitive' } },
            { description: { contains: t, mode: 'insensitive' } },
            { barCode:     { contains: t, mode: 'insensitive' } },
            { brand:    { name: { contains: t, mode: 'insensitive' } } },
            { category: { name: { contains: t, mode: 'insensitive' } } },
            { division: { name: { contains: t, mode: 'insensitive' } } },
          ],
        });
      }
      if (brandIds?.length)      andClauses.push({ brandId:      { in: brandIds } });
      if (categoryIds?.length)   andClauses.push({ categoryId:   { in: categoryIds } });
      if (silhouetteIds?.length) andClauses.push({ silhouetteId: { in: silhouetteIds } });
      if (genderIds?.length)     andClauses.push({ genderId:     { in: genderIds } });
      const where: any = andClauses.length ? { AND: andClauses } : {};

      // ── Build ORDER BY ───────────────────────────────────────────────────
      const directSortFields = new Set(['itemId','sku','unitPrice','isActive','createdAt','updatedAt','description','barCode','hsCode']);
      const relationalSortFields: Record<string, string> = { brand: 'brandId', category: 'categoryId', division: 'divisionId' };
      const direction = sortOrder === 'asc' ? 'asc' : 'desc';
      let orderBy: any;
      if (directSortFields.has(sortBy ?? '')) {
        orderBy = { [sortBy!]: direction };
      } else if (relationalSortFields[sortBy ?? '']) {
        orderBy = { [relationalSortFields[sortBy!]]: direction };
      } else {
        orderBy = { createdAt: 'desc' };
      }

      // ── Count total for progress reporting ───────────────────────────────
      const total = await prisma.item.count({ where });
      this.logger.log(`[Export ${jobId}] ${total} rows to export`);

      // ── Set up ExcelJS streaming writer ──────────────────────────────────
      // ExcelJS streaming writer writes directly to disk — never accumulates
      // the full workbook in memory, so 200k rows ≈ ~150MB on disk but only
      // ~30-50MB heap at any point.
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        filename: filePath,
        useStyles: true,
        useSharedStrings: false, // shared strings index = extra memory, skip for large files
      });

      const ws = workbook.addWorksheet('Items', {
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
      // Fill all cells first so merged-cell styling works with streaming writer
      COLUMNS.forEach((_, idx) => {
        const cell = groupRow.getCell(idx + 1);
        const group = COLUMNS[idx].group;
        const { start } = groups[group];
        // Only set value on the first cell of each group
        if (idx + 1 === start) cell.value = group.toUpperCase();
        cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${GROUP_COLORS[group] ?? '1E293B'}` } };
        cell.font   = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
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
        cell.value = col.header;
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SUBHEADER_BG}` } };
        cell.font  = { bold: true, color: { argb: `FF${SUBHEADER_FG}` }, size: 9 };
        cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
        cell.border = {
          top:    { style: 'thin',   color: { argb: `FF${BORDER_COLOR}` } },
          left:   { style: 'thin',   color: { argb: `FF${BORDER_COLOR}` } },
          bottom: { style: 'medium', color: { argb: `FF${BORDER_COLOR}` } },
          right:  { style: 'thin',   color: { argb: `FF${BORDER_COLOR}` } },
        };
      });
      headerRow.height = 20;
      headerRow.commit();

      // ── Data rows — cursor-paginated in chunks of 500 ────────────────────
      // 500 rows × ~40 cols × ~200 bytes ≈ 4MB per chunk — safe for any heap size
      const CHUNK = 500;
      let cursor: string | undefined;
      let rowIdx = 0;
      let processed = 0;

      while (true) {
        const chunk = await prisma.item.findMany({
          where,
          orderBy,
          take: CHUNK,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          include: includeMasterData,
        });

        if (!chunk.length) break;

        for (const item of chunk) {
          const isAlt = rowIdx % 2 === 1;
          const hasDiscount = (item.discountRate ?? 0) > 0 || (item.discountAmount ?? 0) > 0;

          const rowData: Record<string, any> = {
            itemId:            item.itemId,
            sku:               item.sku,
            barCode:           item.barCode ?? '',
            description:       item.description ?? '',
            status:            item.isActive ? 'Active' : 'Inactive',
            brand:             (item as any).brand?.name ?? '',
            division:          (item as any).division?.name ?? '',
            category:          (item as any).category?.name ?? '',
            subCategory:       (item as any).subCategory?.name ?? '',
            gender:            (item as any).gender?.name ?? '',
            season:            (item as any).season?.name ?? '',
            silhouette:        (item as any).silhouette?.name ?? '',
            channelClass:      (item as any).channelClass?.name ?? '',
            itemClass:         (item as any).itemClass?.name ?? '',
            itemSubclass:      (item as any).itemSubclass?.name ?? '',
            color:             (item as any).color?.name ?? '',
            size:              (item as any).size?.name ?? '',
            unitPrice:         item.unitPrice ?? 0,
            unitCost:          item.unitCost ?? 0,
            fob:               item.fob ?? 0,
            taxRate1:          item.taxRate1 ?? 0,
            taxRate2:          item.taxRate2 ?? 0,
            discountRate:      item.discountRate ?? 0,
            discountAmount:    item.discountAmount ?? 0,
            discountStartDate: item.discountStartDate ? new Date(item.discountStartDate) : null,
            discountEndDate:   item.discountEndDate   ? new Date(item.discountEndDate)   : null,
            hsCode:            (item as any).hsCode?.code ?? item.hsCodeStr ?? '',
            uom:               item.uom ?? '',
            currency:          item.currency ?? '',
            case:              item.case ?? '',
            band:              item.band ?? '',
            movementType:      item.movementType ?? '',
            movementName:      item.movementName ?? '',
            heelHeight:        item.heelHeight ?? '',
            width:             item.width ?? '',
            launchDate:        item.launchDate ? new Date(item.launchDate) : null,
            oldSeason:         item.oldSeason ?? '',
            createdAt:         new Date(item.createdAt),
            updatedAt:         new Date(item.updatedAt),
          };

          const dataRow = ws.getRow(rowIdx + 3);
          COLUMNS.forEach((col, colIdx) => {
            const cell = dataRow.getCell(colIdx + 1);
            cell.value = rowData[col.key] ?? null;
            if (col.numFmt) cell.numFmt = col.numFmt;
            cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };

            const bgColor = hasDiscount && col.group === 'Discounts'
              ? DISCOUNT_BG
              : isAlt ? ALT_ROW_BG : 'FFFFFF';
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bgColor}` } };

            if (col.key === 'status') {
              cell.font = { bold: true, size: 9, color: { argb: item.isActive ? `FF${ACTIVE_FG}` : `FF${INACTIVE_FG}` } };
            } else if (['unitPrice', 'unitCost', 'fob'].includes(col.key)) {
              cell.font = { size: 9, color: { argb: `FF${CURRENCY_FG}` } };
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
          dataRow.commit(); // ← flush row to disk immediately, free memory

          rowIdx++;
        }

        processed += chunk.length;
        cursor = chunk[chunk.length - 1].id;

        // Report progress to Bull (0-100)
        const pct = total > 0 ? Math.round((processed / total) * 95) : 50;
        await job.progress(pct);

        // Yield to event loop between chunks
        await new Promise((r) => setImmediate(r));

        if (chunk.length < CHUNK) break;
      }

      // ── Summary sheet ────────────────────────────────────────────────────
      const summary = workbook.addWorksheet('Summary');
      summary.columns = [{ key: 'label', width: 30 }, { key: 'value', width: 20 }];

      const titleRow = summary.getRow(1);
      titleRow.getCell(1).value = 'Items Export Summary';
      titleRow.getCell(1).font  = { bold: true, size: 14, color: { argb: 'FF1E293B' } };
      titleRow.getCell(1).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      titleRow.height = 28;
      titleRow.commit();

      const summaryRows = [
        ['Export Date',          new Date().toLocaleString('en-PK')],
        ['Total Items',          rowIdx],
        ['Search Filter',        search ?? '(none)'],
        ['Brand Filter',         brandIds?.length      ? `${brandIds.length} selected`      : '(all)'],
        ['Category Filter',      categoryIds?.length   ? `${categoryIds.length} selected`   : '(all)'],
        ['Silhouette Filter',    silhouetteIds?.length ? `${silhouetteIds.length} selected` : '(all)'],
        ['Gender Filter',        genderIds?.length     ? `${genderIds.length} selected`     : '(all)'],
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

      await workbook.commit(); // finalise and flush to disk
      await job.progress(100);

      this.logger.log(`[Export ${jobId}] File written: ${filePath} (${rowIdx} rows)`);

      // ── Notify user via in-app notification ──────────────────────────────
      await this.notificationsService.create({
        userId,
        title: 'Items Export Ready',
        message: `Your export of ${rowIdx.toLocaleString()} item${rowIdx !== 1 ? 's' : ''} is ready to download.`,
        category: 'export',
        priority: 'high',
        actionType: 'item-export.ready',
        actionPayload: { jobId },
        entityType: 'item-export',
        entityId: jobId,
        channels: ['inApp'],
      });

    } catch (error: any) {
      this.logger.error(`[Export ${jobId}] FAILED: ${error.message}`, error.stack);
      // Clean up partial file
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      await this.notificationsService.create({
        userId,
        title: 'Items Export Failed',
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
