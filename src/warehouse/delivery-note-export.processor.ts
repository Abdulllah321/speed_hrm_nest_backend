import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface DeliveryNoteExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
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
  Transfer: '1A3A5C',
  Detail:  '1E4D2B',
};

const COLUMNS: {
  header: string;
  key: string;
  width: number;
  group: string;
  numFmt?: string;
  align?: ExcelJS.Alignment['horizontal'];
}[] = [
  // Transfer
  { header: 'Request No',        key: 'requestNo',              width: 18, group: 'Transfer', align: 'center' },
  { header: 'Date',              key: 'requestDate',            width: 20, group: 'Transfer', numFmt: 'dd-mmm-yyyy hh:mm', align: 'center' },
  { header: 'Expected Date',     key: 'expectedDate',           width: 14, group: 'Transfer', numFmt: 'dd-mmm-yyyy', align: 'center' },
  { header: 'Transfer Type',     key: 'transferType',           width: 24, group: 'Transfer' },
  { header: 'Status',            key: 'status',                 width: 12, group: 'Transfer', align: 'center' },
  { header: 'From Location',     key: 'fromLocation',           width: 24, group: 'Transfer' },
  { header: 'To Location',       key: 'toLocation',             width: 24, group: 'Transfer' },
  { header: 'Notes',             key: 'notes',                  width: 30, group: 'Transfer' },
  { header: 'Created By ID',     key: 'createdById',            width: 18, group: 'Transfer', align: 'center' },
  { header: 'Approved By ID',    key: 'approvedById',           width: 18, group: 'Transfer', align: 'center' },
  { header: 'Requires Src Appr', key: 'requiresSourceApproval', width: 18, group: 'Transfer', align: 'center' },
  { header: 'Src Appr By ID',    key: 'sourceApprovedById',     width: 18, group: 'Transfer', align: 'center' },
  { header: 'Src Appr At',       key: 'sourceApprovedAt',       width: 20, group: 'Transfer', numFmt: 'dd-mmm-yyyy hh:mm', align: 'center' },
  // Detail
  { header: 'Line #',            key: 'lineNo',                 width: 8,  group: 'Detail', align: 'center' },
  { header: 'SKU',               key: 'sku',                    width: 20, group: 'Detail' },
  { header: 'Barcode',           key: 'barCode',                width: 18, group: 'Detail' },
  { header: 'Description',       key: 'description',            width: 36, group: 'Detail' },
  { header: 'Color',             key: 'color',                  width: 14, group: 'Detail' },
  { header: 'Size',              key: 'size',                   width: 10, group: 'Detail', align: 'center' },
  { header: 'Quantity',          key: 'quantity',               width: 14, group: 'Detail', numFmt: '#,##0.00', align: 'right' },
  { header: 'Fulfilled Qty',     key: 'fulfilledQty',           width: 14, group: 'Detail', numFmt: '#,##0.00', align: 'right' },
];

@Processor('delivery-note-export')
export class DeliveryNoteExportProcessor {
  private readonly logger = new Logger(DeliveryNoteExportProcessor.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @Process()
  async handleExport(job: Job<DeliveryNoteExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, warehouseId, status, transferType, search, dateFrom, dateTo } = job.data;

    this.logger.log(`[DeliveryNoteExport ${jobId}] Starting for user ${userId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const filePath = path.join(exportDir, `export-${jobId}.xlsx`);

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
      this.logger.log(`[DeliveryNoteExport ${jobId}] ${total} transfer requests to export`);

      // ── Streaming workbook ─────────────────────────────────────────────────
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        filename: filePath,
        useStyles: true,
        useSharedStrings: false,
      });

      const ws = workbook.addWorksheet('Delivery Notes', {
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
      let processedTransfers = 0;

      while (true) {
        const chunk = await prisma.transferRequest.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: CHUNK,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
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
          const items = transfer.items.length > 0 ? transfer.items : [null];

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

          items.forEach((detail: any, dIdx: number) => {
            const isAlt = rowIdx % 2 === 1;
            const isCompleted = transfer.status === 'COMPLETED' || transfer.status === 'completed';

            const rowData: Record<string, any> = {
              requestNo:              transfer.requestNo,
              requestDate:            new Date(transfer.createdAt),
              expectedDate:           transfer.expectedDate ? new Date(transfer.expectedDate) : null,
              transferType:           transfer.transferType,
              status:                 transfer.status.toUpperCase(),
              fromLocation:           fromLocName,
              toLocation:             toLocName,
              notes:                  transfer.notes ?? '',
              createdById:            transfer.createdById ?? '',
              approvedById:           transfer.approvedById ?? '',
              requiresSourceApproval: transfer.requiresSourceApproval ? 'Yes' : 'No',
              sourceApprovedById:     transfer.sourceApprovedById ?? '',
              sourceApprovedAt:       transfer.sourceApprovedAt ? new Date(transfer.sourceApprovedAt) : null,
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
            COLUMNS.forEach((col, colIdx) => {
              const cell = dataRow.getCell(colIdx + 1);
              cell.value     = rowData[col.key] ?? null;
              if (col.numFmt && rowData[col.key] !== null && rowData[col.key] !== '')
                cell.numFmt = col.numFmt;
              cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
              cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${isAlt ? ALT_ROW_BG : 'FFFFFF'}` } };

              if (col.key === 'status') {
                cell.font = { bold: true, size: 9, color: { argb: isCompleted ? 'FF15803D' : 'FFB45309' } };
              } else if (col.key === 'quantity') {
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

        processedTransfers += chunk.length;
        cursor = chunk[chunk.length - 1].id;

        const pct = total > 0 ? Math.round((processedTransfers / total) * 95) : 50;
        await job.progress(pct);
        await new Promise((r) => setImmediate(r));

        if (chunk.length < CHUNK) break;
      }

      // ── Summary sheet ──────────────────────────────────────────────────────
      const summary = workbook.addWorksheet('Summary');
      summary.columns = [{ key: 'label', width: 28 }, { key: 'value', width: 24 }];
      const titleRow = summary.getRow(1);
      titleRow.getCell(1).value     = 'Delivery Notes Export Summary';
      titleRow.getCell(1).font      = { bold: true, size: 14, color: { argb: 'FF1E293B' } };
      titleRow.getCell(1).fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      titleRow.height = 28;
      titleRow.commit();

      const summaryRows = [
        ['Export Date',    new Date().toLocaleString('en-PK')],
        ['Total Transfers', processedTransfers],
        ['Total Item Rows', rowIdx],
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

      this.logger.log(`[DeliveryNoteExport ${jobId}] File written (${processedTransfers} transfers, ${rowIdx} rows)`);

      await this.notificationsService.create({
        userId,
        title: 'Delivery Note Export Ready',
        message: `Your export of ${processedTransfers.toLocaleString()} delivery note${processedTransfers !== 1 ? 's' : ''} is ready to download.`,
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
