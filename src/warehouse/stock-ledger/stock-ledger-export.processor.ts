import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { MovementType } from '@prisma/client';

export interface StockLedgerExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  warehouseId?: string;
  locationId?: string;
  movementType?: MovementType;
  itemId?: string;
  referenceType?: string;
  search?: string;
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
  Item:       '1E3A5F',
  Location:   '1E4D2B',
  Details:    '4A1942',
  Financial:  '1A3A4A',
  Reference:  '3D2B00',
};

const COLUMNS: {
  header: string;
  key: string;
  width: number;
  group: string;
  numFmt?: string;
  align?: ExcelJS.Alignment['horizontal'];
}[] = [
  // Item Info
  { header: 'SKU',             key: 'sku',             width: 16, group: 'Item',      align: 'center' },
  { header: 'Description',     key: 'description',     width: 30, group: 'Item' },
  // Location Info
  { header: 'Warehouse',       key: 'warehouse',       width: 20, group: 'Location' },
  { header: 'Location',        key: 'location',        width: 20, group: 'Location' },
  // Details
  { header: 'Movement Type',   key: 'movementType',    width: 16, group: 'Details',   align: 'center' },
  { header: 'Quantity',        key: 'qty',             width: 14, group: 'Details',   numFmt: '#,##0.00', align: 'right' },
  // Financial
  { header: 'Unit Price',      key: 'unitPrice',       width: 14, group: 'Financial', numFmt: '#,##0.00', align: 'right' },
  { header: 'Total Price',     key: 'totalPrice',      width: 16, group: 'Financial', numFmt: '#,##0.00', align: 'right' },
  // Reference
  { header: 'Source',          key: 'referenceType',   width: 18, group: 'Reference', align: 'center' },
  { header: 'Reference ID',    key: 'referenceId',     width: 36, group: 'Reference', align: 'center' },
  { header: 'Date',            key: 'createdAt',       width: 20, group: 'Reference', numFmt: 'dd-mmm-yyyy hh:mm', align: 'center' },
];

@Processor('stock-ledger-export')
export class StockLedgerExportProcessor {
  private readonly logger = new Logger(StockLedgerExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
  ) {}

  @Process()
  async handleExport(job: Job<StockLedgerExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, warehouseId, locationId, movementType, itemId, referenceType, search } = job.data;

    this.logger.log(`[StockLedgerExport ${jobId}] Starting for user ${userId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const filePath = path.join(exportDir, `export-${jobId}.xlsx`);

    try {
      // ── Build WHERE ──────────────────────────────────────────────────────
      const where: any = {
        ...(warehouseId && { warehouseId }),
        ...(locationId && { locationId }),
        ...(movementType && { movementType }),
        ...(itemId && { itemId }),
        ...(referenceType && { referenceType }),
      };

      if (search) {
        const searchLower = search.toLowerCase().trim();
        const cleanSearch = search.startsWith("#") ? search.slice(1) : search;

        // 1. Resolve matching locations
        const matchingLocations = await prisma.location.findMany({
          where: { name: { contains: search, mode: 'insensitive' } },
          select: { id: true },
        });
        const locationIds = matchingLocations.map((l) => l.id);

        // 2. Resolve friendly reference types to enum values
        const REVERSE_REFERENCE_LABELS: Record<string, string[]> = {
          "grn": ["GRN"],
          "pos sale": ["POS_SALE"],
          "pos return": ["POS_RETURN"],
          "pos void": ["POS_VOID"],
          "transfer": ["TRANSFER_REQUEST"],
          "return transfer": ["RETURN_REQUEST"],
          "outlet transfer in": ["OUTLET_TRANSFER_IN"],
          "outlet transfer out": ["OUTLET_TRANSFER_OUT"],
          "stock movement": ["STOCK_MOVEMENT"],
          "return movement": ["RETURN_MOVEMENT"],
          "adjustment": ["ADJUSTMENT"],
          "landed cost": ["LANDED_COST"],
          "opening bal": ["OPENING_BALANCE"],
          "delivery challan": ["DELIVERY_CHALLAN"],
          "purchase return": ["PURCHASE_RETURN", "PURCHASE_RETURN_LC", "PURCHASE_RETURN_GRN"],
          "bulk upload": ["BULK_STOCK_UPLOAD"],
          "pos claim return": ["POS_CLAIM_APPROVED"],
          "claim acknowledged": ["CLAIM_ACKNOWLEDGED"],
        };

        const matchedEnumValues: string[] = [];
        for (const [friendly, enums] of Object.entries(REVERSE_REFERENCE_LABELS)) {
          if (friendly.includes(searchLower) || searchLower.includes(friendly)) {
            matchedEnumValues.push(...enums);
          }
        }

        // 3. Resolve direction (movementType)
        let matchedMovementType: MovementType | undefined = undefined;
        if (searchLower === "inbound" || searchLower === "in") {
          matchedMovementType = MovementType.INBOUND;
        } else if (searchLower === "outbound" || searchLower === "out") {
          matchedMovementType = MovementType.OUTBOUND;
        }

        // 4. Resolve quantity
        const searchNum = parseFloat(searchLower);
        const isSearchNum = !isNaN(searchNum);

        where.OR = [
          { item: { sku: { contains: search, mode: 'insensitive' } } },
          { item: { description: { contains: search, mode: 'insensitive' } } },
          { warehouse: { name: { contains: search, mode: 'insensitive' } } },
          { referenceId: { contains: cleanSearch, mode: 'insensitive' } },
          { referenceType: { contains: search, mode: 'insensitive' } },
          ...(locationIds.length > 0 ? [{ locationId: { in: locationIds } }] : []),
          ...(matchedEnumValues.length > 0 ? [{ referenceType: { in: matchedEnumValues } }] : []),
          ...(matchedMovementType ? [{ movementType: matchedMovementType }] : []),
          ...(isSearchNum ? [{ qty: searchNum }] : []),
        ];
      }

      const total = await prisma.stockLedger.count({ where });
      this.logger.log(`[StockLedgerExport ${jobId}] ${total} rows to export`);

      // ── Streaming workbook writer ────────────────────────────────────────
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        filename: filePath,
        useStyles: true,
        useSharedStrings: false,
      });

      const ws = workbook.addWorksheet('Stock Ledger', {
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
        const chunk = await prisma.stockLedger.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: CHUNK,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          select: {
            id: true,
            itemId: true,
            warehouseId: true,
            qty: true,
            rate: true,
            unitCost: true,
            movementType: true,
            referenceType: true,
            referenceId: true,
            locationId: true,
            createdAt: true,
            item: { select: { itemId: true, sku: true, description: true, unitPrice: true } },
            warehouse: { select: { name: true } },
          },
        });

        if (!chunk.length) break;

        // Enrich locations in the chunk
        const locationIds = [...new Set(chunk.map((d) => d.locationId).filter(Boolean))] as string[];
        const locationMap = new Map<string, { name: string; code: string }>();
        if (locationIds.length > 0) {
          const locations = await prisma.location.findMany({
            where: { id: { in: locationIds } },
            select: { id: true, name: true, code: true },
          });
          for (const loc of locations) {
            locationMap.set(loc.id, { name: loc.name, code: loc.code });
          }
        }

        for (const entry of chunk) {
          const isAlt = rowIdx % 2 === 1;
          const locationName = entry.locationId ? (locationMap.get(entry.locationId)?.name ?? '') : '';

          const qtyNum = Number(entry.qty ?? 0);
          const unitPriceNum = Number(entry.item?.unitPrice ?? 0);
          const totalPriceNum = qtyNum * unitPriceNum;

          const rowData: Record<string, any> = {
            sku: entry.item?.sku || entry.itemId,
            description: entry.item?.description || '',
            warehouse: entry.warehouse?.name || entry.warehouseId,
            location: locationName,
            movementType: entry.movementType,
            qty: qtyNum,
            unitPrice: unitPriceNum || null,
            totalPrice: entry.item?.unitPrice && entry.qty ? Math.abs(totalPriceNum) : null,
            referenceType: entry.referenceType,
            referenceId: entry.referenceId,
            createdAt: new Date(entry.createdAt),
          };

          const dataRow = ws.getRow(rowIdx + 3);
          COLUMNS.forEach((col, colIdx) => {
            const cell = dataRow.getCell(colIdx + 1);
            cell.value     = rowData[col.key] ?? null;
            if (col.numFmt) cell.numFmt = col.numFmt;
            cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
            cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${isAlt ? ALT_ROW_BG : 'FFFFFF'}` } };

            if (col.key === 'qty') {
              const isOut = qtyNum < 0;
              cell.font = { bold: true, size: 9, color: { argb: isOut ? `FF${INACTIVE_FG}` : `FF${ACTIVE_FG}` } };
            } else if (['unitPrice', 'totalPrice'].includes(col.key)) {
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
      titleRow.getCell(1).value     = 'Stock Ledger Export Summary';
      titleRow.getCell(1).font      = { bold: true, size: 14, color: { argb: 'FF1E293B' } };
      titleRow.getCell(1).fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      titleRow.height = 28;
      titleRow.commit();

      const summaryRows = [
        ['Export Date',    new Date().toLocaleString('en-PK')],
        ['Total Rows',     rowIdx],
        ['Warehouse ID',   warehouseId ?? '(all)'],
        ['Movement Type',  movementType ?? '(all)'],
        ['Item ID',        itemId ?? '(all)'],
        ['Reference Type', referenceType ?? '(all)'],
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

      this.logger.log(`[StockLedgerExport ${jobId}] File written (${rowIdx} rows)`);

      await this.notificationsService.create({
        userId,
        title: 'Stock Ledger Export Ready',
        message: `Your export of ${rowIdx.toLocaleString()} stock ledger entry/entries is ready to download.`,
        category: 'export',
        priority: 'high',
        actionType: 'stock-ledger-export.ready',
        actionPayload: { jobId },
        entityType: 'stock-ledger-export',
        entityId: jobId,
        channels: ['inApp'],
      });

    } catch (error: any) {
      this.logger.error(`[StockLedgerExport ${jobId}] FAILED: ${error.message}`, error.stack);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      await this.notificationsService.create({
        userId,
        title: 'Stock Ledger Export Failed',
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
