import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ExportHistoryService } from './export-history/export-history.service';

export interface DeliveryNoteExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  reportType?: 'summary' | 'detailed';
  warehouseId?: string;
  status?: string;
  transferType?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

// ── Colour palette ────────────────────────────────────────────────────────────
const SUBHEADER_BG = '1E3A5F';
const SUBHEADER_FG = 'F1F5F9';
const ALT_ROW_BG   = 'F0F4F8';
const BORDER_COLOR = 'CBD5E1';

const GROUP_COLORS: Record<string, string> = {
  'Transfer Overview': '1A3A5C',
  'Transfer Info':     '1A3A5C',
  'Item Details':      '1E4D2B',
};

const SUMMARY_COLUMNS: {
  header: string;
  key: string;
  width: number;
  group: string;
  numFmt?: string;
  align?: ExcelJS.Alignment['horizontal'];
}[] = [
  { header: 'Transfer Number (STN)', key: 'requestNo',     width: 22, group: 'Transfer Overview', align: 'center' },
  { header: 'Out No',                 key: 'outNo',         width: 14, group: 'Transfer Overview', align: 'center' },
  { header: 'In No',                  key: 'inNo',          width: 14, group: 'Transfer Overview', align: 'center' },
  { header: 'Status',                 key: 'status',        width: 14, group: 'Transfer Overview', align: 'center' },
  { header: 'Transfer Type',          key: 'transferType',  width: 24, group: 'Transfer Overview' },
  { header: 'Dispatch Method',       key: 'dispatchType',  width: 16, group: 'Transfer Overview', align: 'center' },
  { header: 'Courier / Provider',     key: 'courierName',   width: 18, group: 'Transfer Overview' },
  { header: 'Tracking / Invoice #',  key: 'trackingNumber', width: 22, group: 'Transfer Overview', align: 'center' },
  { header: 'Rider / Handover',       key: 'riderName',     width: 20, group: 'Transfer Overview' },
  { header: 'Transfer Date',          key: 'requestDate',   width: 20, group: 'Transfer Overview', numFmt: 'dd-mmm-yyyy hh:mm', align: 'center' },
  { header: 'Expected Date',          key: 'expectedDate',  width: 14, group: 'Transfer Overview', numFmt: 'dd-mmm-yyyy', align: 'center' },
  { header: 'From Location / WH',     key: 'fromLocation',  width: 26, group: 'Transfer Overview' },
  { header: 'To Location / WH',       key: 'toLocation',    width: 26, group: 'Transfer Overview' },
  { header: 'Total SKU Types',        key: 'itemCount',     width: 16, group: 'Transfer Overview', numFmt: '#,##0', align: 'right' },
  { header: 'Total Quantity',         key: 'totalQuantity', width: 16, group: 'Transfer Overview', numFmt: '#,##0.00', align: 'right' },
  { header: 'Remarks / Notes',        key: 'notes',         width: 32, group: 'Transfer Overview' },
];

const DETAILED_COLUMNS: {
  header: string;
  key: string;
  width: number;
  group: string;
  numFmt?: string;
  align?: ExcelJS.Alignment['horizontal'];
}[] = [
  // Transfer Info
  { header: 'Transfer Number (STN)', key: 'requestNo',     width: 22, group: 'Transfer Info', align: 'center' },
  { header: 'Out No',                 key: 'outNo',         width: 14, group: 'Transfer Info', align: 'center' },
  { header: 'In No',                  key: 'inNo',          width: 14, group: 'Transfer Info', align: 'center' },
  { header: 'Status',                 key: 'status',        width: 14, group: 'Transfer Info', align: 'center' },
  { header: 'Transfer Type',          key: 'transferType',  width: 24, group: 'Transfer Info' },
  { header: 'Dispatch Method',       key: 'dispatchType',  width: 16, group: 'Transfer Info', align: 'center' },
  { header: 'Courier / Provider',     key: 'courierName',   width: 18, group: 'Transfer Info' },
  { header: 'Tracking / Invoice #',  key: 'trackingNumber', width: 22, group: 'Transfer Info', align: 'center' },
  { header: 'Rider / Handover',       key: 'riderName',     width: 20, group: 'Transfer Info' },
  { header: 'Transfer Date',          key: 'requestDate',   width: 20, group: 'Transfer Info', numFmt: 'dd-mmm-yyyy hh:mm', align: 'center' },
  { header: 'Expected Date',          key: 'expectedDate',  width: 14, group: 'Transfer Info', numFmt: 'dd-mmm-yyyy', align: 'center' },
  { header: 'From Location / WH',     key: 'fromLocation',  width: 26, group: 'Transfer Info' },
  { header: 'To Location / WH',       key: 'toLocation',    width: 26, group: 'Transfer Info' },
  { header: 'Total Quantity',         key: 'totalQuantity', width: 14, group: 'Transfer Info', numFmt: '#,##0.00', align: 'right' },
  { header: 'Remarks / Notes',        key: 'notes',         width: 32, group: 'Transfer Info' },

  // Item Details
  { header: 'Line #',                 key: 'lineNo',        width: 8,  group: 'Item Details', align: 'center' },
  { header: 'SKU',                    key: 'sku',           width: 20, group: 'Item Details' },
  { header: 'Barcode',                key: 'barCode',       width: 18, group: 'Item Details' },
  { header: 'Description',            key: 'description',   width: 36, group: 'Item Details' },
  { header: 'Color',                  key: 'color',         width: 14, group: 'Item Details' },
  { header: 'Size',                   key: 'size',          width: 10, group: 'Item Details', align: 'center' },
  { header: 'Line Qty',               key: 'quantity',      width: 14, group: 'Item Details', numFmt: '#,##0.00', align: 'right' },
  { header: 'Fulfilled Qty',          key: 'fulfilledQty',  width: 14, group: 'Item Details', numFmt: '#,##0.00', align: 'right' },
];

@Processor('delivery-note-export')
export class DeliveryNoteExportProcessor {
  private readonly logger = new Logger(DeliveryNoteExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly exportHistoryService: ExportHistoryService,
  ) {}

  @Process()
  async handleExport(job: Job<DeliveryNoteExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, reportType = 'detailed', warehouseId, status, transferType, search, dateFrom, dateTo } = job.data;

    this.logger.log(`[DeliveryNoteExport ${jobId}] Starting ${reportType} export for user ${userId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const fileName = `delivery-notes-${reportType}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    const filePath = path.join(exportDir, `export-${jobId}.xlsx`);

    const activeColumns = reportType === 'summary' ? SUMMARY_COLUMNS : DETAILED_COLUMNS;

    try {
      // ── Build WHERE ────────────────────────────────────────────────────────
      const andClauses: any[] = [];
      if (search) {
        const t = search.trim();
        andClauses.push({
          requestNo: { contains: t, mode: 'insensitive' }
        });
      }
      if (warehouseId && warehouseId !== 'all') {
        andClauses.push({ fromWarehouseId: warehouseId });
      }
      if (status && status !== 'all') {
        andClauses.push({ status });
      }
      if (transferType && transferType !== 'all') {
        andClauses.push({ transferType });
      }
      if (dateFrom || dateTo) {
        const dateFilter: any = {};
        if (dateFrom) dateFilter.gte = new Date(dateFrom);
        if (dateTo)   dateFilter.lte = new Date(new Date(dateTo).setHours(23, 59, 59, 999));
        andClauses.push({ createdAt: dateFilter });
      }
      const where: any = andClauses.length ? { AND: andClauses } : {};

      const total = await prisma.transferRequest.count({ where });
      this.logger.log(`[DeliveryNoteExport ${jobId}] ${total} transfer requests to export (${reportType})`);

      // ── Pre-calculate Out No and In No for sequence ────────────────────────
      const allTransfersMeta = await prisma.transferRequest.findMany({
        where,
        select: { id: true, fromLocationId: true, fromWarehouseId: true, toLocationId: true, toWarehouseId: true },
        orderBy: { createdAt: 'asc' },
      });

      const outCounters = new Map<string, number>();
      const inCounters = new Map<string, number>();
      const outNoMap = new Map<string, string>();
      const inNoMap = new Map<string, string>();

      allTransfersMeta.forEach((t) => {
        const srcKey = t.fromLocationId || t.fromWarehouseId;
        if (srcKey) {
          const count = (outCounters.get(srcKey) || 0) + 1;
          outCounters.set(srcKey, count);
          outNoMap.set(t.id, `OUT-${count.toString().padStart(4, '0')}`);
        } else {
          outNoMap.set(t.id, 'OUT-0000');
        }

        const destKey = t.toLocationId || t.toWarehouseId;
        if (destKey) {
          const count = (inCounters.get(destKey) || 0) + 1;
          inCounters.set(destKey, count);
          inNoMap.set(t.id, `IN-${count.toString().padStart(4, '0')}`);
        } else {
          inNoMap.set(t.id, 'IN-0000');
        }
      });

      // ── Streaming workbook ─────────────────────────────────────────────────
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        filename: filePath,
        useStyles: true,
        useSharedStrings: false,
      });

      const sheetTitle = reportType === 'summary' ? 'Delivery Notes Summary' : 'Delivery Notes Detailed';
      const ws = workbook.addWorksheet(sheetTitle, {
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
        views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }],
      });

      ws.columns = activeColumns.map((c) => ({ key: c.key, width: c.width }));

      // ── Row 1: Group header bands ──────────────────────────────────────────
      const groups: Record<string, { start: number; end: number }> = {};
      activeColumns.forEach((col, idx) => {
        const n = idx + 1;
        if (!groups[col.group]) groups[col.group] = { start: n, end: n };
        else groups[col.group].end = n;
      });

      const groupRow = ws.getRow(1);
      activeColumns.forEach((col, idx) => {
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
      activeColumns.forEach((col, idx) => {
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

      // ── Data rows — offset-paginated in chunks of 500 per AGENTS.md rule ────
      const CHUNK = 500;
      let rowIdx = 0;
      let processedTransfers = 0;

      while (processedTransfers < total) {
        const chunk = await prisma.transferRequest.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: processedTransfers,
          take: CHUNK,
          include: {
            items: {
              include: {
                item: {
                  include: {
                    color: true,
                    size: true
                  }
                }
              }
            },
            fromWarehouse: { select: { name: true, code: true } },
            toWarehouse: { select: { name: true, code: true } },
            fromLocation: { select: { name: true, code: true } },
            toLocation: { select: { name: true, code: true } },
          },
        });

        if (!chunk.length) break;

        for (const transfer of chunk) {
          // Determine Transfer Path Details
          let fromLocName = '';
          let toLocName = '';
          if (transfer.transferType === 'OUTLET_TO_WAREHOUSE') {
            fromLocName = transfer.fromLocation?.name || 'Outlet';
            toLocName = transfer.fromWarehouse?.name || 'Main Warehouse';
          } else {
            fromLocName = transfer.fromWarehouse?.name || '';
            toLocName = transfer.toLocation?.name || transfer.toWarehouse?.name || '';
          }

          const outNo = outNoMap.get(transfer.id) || 'OUT-0000';
          const inNo = inNoMap.get(transfer.id) || 'IN-0000';
          const totalQty = transfer.items.reduce((sum: number, i: any) => sum + Number(i.quantity || 0), 0);

          if (reportType === 'summary') {
            // ── SUMMARY / PREVIEW EXPORT: 1 ROW PER TRANSFER ────────────────
            const isAlt = rowIdx % 2 === 1;
            const isCompleted = transfer.status === 'COMPLETED' || transfer.status === 'completed';

            const rowData: Record<string, any> = {
              requestNo:     transfer.requestNo,
              outNo:         outNo,
              inNo:          inNo,
              status:        transfer.status.toUpperCase(),
              transferType:  transfer.transferType,
              dispatchType:  transfer.dispatchType || 'NOT_SPECIFIED',
              courierName:   transfer.courierName || '-',
              trackingNumber: transfer.trackingNumber || '-',
              riderName:     transfer.riderName || transfer.receiverPerson || '-',
              requestDate:   new Date(transfer.createdAt),
              expectedDate:  transfer.expectedDate ? new Date(transfer.expectedDate) : null,
              fromLocation:  fromLocName,
              toLocation:    toLocName,
              itemCount:     transfer.items.length,
              totalQuantity: totalQty,
              notes:         transfer.notes ?? '',
            };

            const dataRow = ws.getRow(rowIdx + 3);
            activeColumns.forEach((col, colIdx) => {
              const cell = dataRow.getCell(colIdx + 1);
              cell.value     = rowData[col.key] ?? null;
              if (col.numFmt && rowData[col.key] !== null && rowData[col.key] !== '')
                cell.numFmt = col.numFmt;
              cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
              cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${isAlt ? ALT_ROW_BG : 'FFFFFF'}` } };

              if (col.key === 'status') {
                cell.font = { bold: true, size: 9, color: { argb: isCompleted ? 'FF15803D' : 'FFB45309' } };
              } else if (col.key === 'outNo') {
                cell.font = { bold: true, size: 9, color: { argb: 'FFC05621' } };
              } else if (col.key === 'inNo') {
                cell.font = { bold: true, size: 9, color: { argb: 'FF0D9488' } };
              } else if (col.key === 'totalQuantity') {
                cell.font = { bold: true, size: 9, color: { argb: 'FF1D4ED8' } };
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

            dataRow.height = 18;
            dataRow.commit();
            rowIdx++;
          } else {
            // ── DETAILED EXPORT: 1 ROW PER ITEM DETAIL ──────────────────────
            const items = transfer.items.length > 0 ? transfer.items : [null];

            items.forEach((detail: any, dIdx: number) => {
              const isAlt = rowIdx % 2 === 1;
              const isCompleted = transfer.status === 'COMPLETED' || transfer.status === 'completed';

              const rowData: Record<string, any> = {
                requestNo:              transfer.requestNo,
                outNo:                  outNo,
                inNo:                   inNo,
                status:                 transfer.status.toUpperCase(),
                transferType:           transfer.transferType,
                dispatchType:           transfer.dispatchType || 'NOT_SPECIFIED',
                courierName:            transfer.courierName || '-',
                trackingNumber:         transfer.trackingNumber || '-',
                riderName:              transfer.riderName || transfer.receiverPerson || '-',
                requestDate:            new Date(transfer.createdAt),
                expectedDate:           transfer.expectedDate ? new Date(transfer.expectedDate) : null,
                fromLocation:           fromLocName,
                toLocation:             toLocName,
                totalQuantity:          totalQty,
                notes:                  transfer.notes ?? '',
                lineNo:                 detail ? dIdx + 1 : '',
                sku:                    detail?.item?.sku            ?? '',
                barCode:                detail?.item?.barCode        ?? '',
                description:            detail?.item?.description    ?? '',
                color:                  detail?.item?.color?.name    ?? '',
                size:                   detail?.item?.size?.name     ?? '',
                quantity:               detail ? Number(detail.quantity) : null,
                fulfilledQty:           detail ? Number(detail.fulfilledQty) : null,
              };

              const dataRow = ws.getRow(rowIdx + 3);
              activeColumns.forEach((col, colIdx) => {
                const cell = dataRow.getCell(colIdx + 1);
                cell.value     = rowData[col.key] ?? null;
                if (col.numFmt && rowData[col.key] !== null && rowData[col.key] !== '')
                  cell.numFmt = col.numFmt;
                cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
                cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${isAlt ? ALT_ROW_BG : 'FFFFFF'}` } };

                if (col.key === 'status') {
                  cell.font = { bold: true, size: 9, color: { argb: isCompleted ? 'FF15803D' : 'FFB45309' } };
                } else if (col.key === 'outNo') {
                  cell.font = { bold: true, size: 9, color: { argb: 'FFC05621' } };
                } else if (col.key === 'inNo') {
                  cell.font = { bold: true, size: 9, color: { argb: 'FF0D9488' } };
                } else if (col.key === 'quantity' || col.key === 'totalQuantity') {
                  cell.font = { size: 9, color: { argb: 'FF1D4ED8' } };
                } else if (col.key === 'fulfilledQty') {
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
        }

        processedTransfers += chunk.length;

        const pct = total > 0 ? Math.round((processedTransfers / total) * 95) : 50;
        await job.progress(pct);
        await new Promise((r) => setImmediate(r));
      }

      // ── Summary sheet ──────────────────────────────────────────────────────
      const summary = workbook.addWorksheet('Summary');
      summary.columns = [{ key: 'label', width: 28 }, { key: 'value', width: 24 }];
      const titleRow = summary.getRow(1);
      titleRow.getCell(1).value     = `Delivery Notes Export Summary (${reportType.toUpperCase()})`;
      titleRow.getCell(1).font      = { bold: true, size: 14, color: { argb: 'FF1E293B' } };
      titleRow.getCell(1).fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      titleRow.height = 28;
      titleRow.commit();

      const summaryRows = [
        ['Export Date',    new Date().toLocaleString('en-PK')],
        ['Export Type',    reportType.toUpperCase()],
        ['Total Transfers', processedTransfers],
        ['Total Export Rows', rowIdx],
        ['Warehouse ID',   warehouseId ?? '(all)'],
        ['Status Filter',  status ?? '(all)'],
        ['Type Filter',    transferType ?? '(all)'],
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

      // Upload file to S3 / Object Storage & Update ExportHistory record to COMPLETED
      const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      await this.exportHistoryService.completeAndUploadExport(
        prisma,
        jobId,
        filePath,
        fileName,
        mimeType,
      );

      this.logger.log(`[DeliveryNoteExport ${jobId}] File uploaded and ${reportType} export completed (${processedTransfers} transfers, ${rowIdx} rows)`);

      await this.notificationsService.create({
        userId,
        title: 'Delivery Note Export Ready',
        message: `Your ${reportType} export of ${processedTransfers.toLocaleString()} delivery note${processedTransfers !== 1 ? 's' : ''} is ready to download.`,
        category: 'export',
        priority: 'high',
        actionType: 'delivery-note-export.ready',
        actionPayload: { jobId },
        entityType: 'delivery-note-export',
        entityId: jobId,
        channels: ['inApp'],
      });

    } catch (error: any) {
      this.logger.error(`[DeliveryNoteExport ${jobId}] FAILED: ${error.message}`, error.stack);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      await this.exportHistoryService.failExport(prisma, jobId);

      await this.notificationsService.create({
        userId,
        title: 'Delivery Note Export Failed',
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
