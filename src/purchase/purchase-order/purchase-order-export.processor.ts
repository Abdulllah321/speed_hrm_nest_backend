import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ExportHistoryService } from '../../warehouse/export-history/export-history.service';

export interface PurchaseOrderExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  poId?: string;
  status?: string;
  vendorId?: string;
  brandId?: string;
  orderType?: string;
  goodsType?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}

// ── Colour palette ────────────────────────────────────────────────────────────
const PRIMARY_BG   = '1E3A5F'; // Dark Slate Navy
const PRIMARY_FG   = 'FFFFFF';
const SUBHEADER_BG = '2563EB'; // Blue-600
const ALT_ROW_BG   = 'F8FAFC'; // Slate-50
const BORDER_COLOR = 'CBD5E1'; // Slate-300
const HIGHLIGHT_BG = 'F1F5F9';

function numberToWords(amount: number): string {
  const a = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen',
  ];
  const b = [
    '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
  ];

  const inWords = (num: number): string => {
    const n = Math.floor(num);
    if (n === 0) return 'Zero';

    const convert = (val: number): string => {
      if (val < 20) return a[val];
      if (val < 100) return b[Math.floor(val / 10)] + (val % 10 !== 0 ? '-' + a[val % 10] : '');
      if (val < 1000) return a[Math.floor(val / 100)] + ' Hundred' + (val % 100 !== 0 ? ' ' + convert(val % 100) : '');
      if (val < 1000000) return convert(Math.floor(val / 1000)) + ' Thousand' + (val % 1000 !== 0 ? ' ' + convert(val % 1000) : '');
      if (val < 1000000000) return convert(Math.floor(val / 1000000)) + ' Million' + (val % 1000000 !== 0 ? ' ' + convert(val % 1000000) : '');
      return convert(Math.floor(val / 1000000000)) + ' Billion' + (val % 1000000000 !== 0 ? ' ' + convert(val % 1000000000) : '');
    };

    return convert(n) + ' Only';
  };

  return `Rs. ${inWords(amount)}.`;
}

@Processor('purchase-order-export')
export class PurchaseOrderExportProcessor {
  private readonly logger = new Logger(PurchaseOrderExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly exportHistoryService: ExportHistoryService,
  ) {}

  @Process()
  async handleExport(job: Job<PurchaseOrderExportJobData>): Promise<void> {
    const {
      jobId,
      userId,
      tenantId,
      tenantDbUrl,
      poId,
      status,
      vendorId,
      brandId,
      orderType,
      goodsType,
      startDate,
      endDate,
      search,
    } = job.data;

    this.logger.log(`[PurchaseOrderExport ${jobId}] Starting export for user ${userId}${poId ? ` (PO: ${poId})` : ''}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const filePath = path.join(exportDir, `export-${jobId}.xlsx`);

    try {
      if (poId) {
        // ── SINGLE PO EXPORT ──────────────────────────────────────────────────
        await this.exportSinglePurchaseOrder(prisma, job, filePath);
      } else {
        // ── MULTI / LIST PO EXPORT ────────────────────────────────────────────
        await this.exportPurchaseOrderList(prisma, job, filePath);
      }

      await job.progress(95);

      // Upload file to S3 / Object Storage & Update ExportHistory record to COMPLETED
      let fileName = `purchase-order-${new Date().toISOString().slice(0, 10)}.xlsx`;
      if (poId) {
        const poRecord = await prisma.purchaseOrder.findUnique({
          where: { id: poId },
          select: { poNumber: true },
        });
        if (poRecord?.poNumber) {
          fileName = `${poRecord.poNumber}-${new Date().toISOString().slice(0, 10)}.xlsx`;
        }
      }

      const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      await this.exportHistoryService.completeAndUploadExport(
        prisma,
        jobId,
        filePath,
        fileName,
        mimeType,
      );

      this.logger.log(`[PurchaseOrderExport ${jobId}] File uploaded and export completed`);

      await this.notificationsService.create({
        userId,
        title: 'Purchase Order Export Ready',
        message: poId
          ? `Your Purchase Order (${fileName.replace('.xlsx', '')}) export is ready for download.`
          : 'Your Purchase Orders export is ready for download.',
        category: 'export',
        priority: 'high',
        actionType: 'purchase-order-export.ready',
        actionPayload: { jobId, fileName },
        entityType: 'purchase-order-export',
        entityId: jobId,
        channels: ['inApp'],
      });

      await job.progress(100);
    } catch (error: any) {
      this.logger.error(`[PurchaseOrderExport ${jobId}] FAILED: ${error.message}`, error.stack);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      await this.exportHistoryService.failExport(prisma, jobId);

      await this.notificationsService.create({
        userId,
        title: 'Purchase Order Export Failed',
        message: `Export could not be completed: ${error.message}`,
        category: 'export',
        priority: 'urgent',
        channels: ['inApp'],
      });
    } finally {
      await prisma.$disconnect();
    }
  }

  /**
   * Generates a single Purchase Order Excel sheet with full styling, header, items table, and totals.
   */
  private async exportSinglePurchaseOrder(
    prisma: PrismaService,
    job: Job<PurchaseOrderExportJobData>,
    filePath: string,
  ): Promise<void> {
    const { poId } = job.data;
    await job.progress(10);

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: {
        vendor: true,
        items: {
          include: {
            item: {
              include: {
                brand: true,
                division: true,
                category: true,
                subCategory: true,
                gender: true,
                silhouette: true,
                color: true,
                size: true,
              },
            },
          },
        },
      },
    });

    if (!po) {
      throw new Error(`Purchase Order with ID ${poId} not found`);
    }

    await job.progress(30);

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: filePath,
      useStyles: true,
      useSharedStrings: true,
    });

    const ws = workbook.addWorksheet(`PO_${po.poNumber || 'Detail'}`, {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
      views: [{ state: 'frozen', xSplit: 0, ySplit: 11 }],
    });

    // Define columns
    ws.columns = [
      { key: 'lineNo',      width: 8 },
      { key: 'sku',         width: 18 },
      { key: 'barCode',     width: 18 },
      { key: 'description', width: 32 },
      { key: 'brand',       width: 16 },
      { key: 'division',    width: 14 },
      { key: 'category',    width: 16 },
      { key: 'subCategory', width: 16 },
      { key: 'gender',      width: 12 },
      { key: 'silhouette',  width: 14 },
      { key: 'color',       width: 14 },
      { key: 'size',        width: 10 },
      { key: 'quantity',    width: 14 },
      { key: 'receivedQty', width: 14 },
      { key: 'unitPrice',   width: 15 },
      { key: 'taxPercent',  width: 10 },
      { key: 'discountPercent', width: 10 },
      { key: 'lineTotal',   width: 16 },
    ];

    // ── Row 1: Company Header ────────────────────────────────────────────────
    const r1 = ws.getRow(1);
    r1.getCell(1).value = 'SPEED (PRIVATE) LIMITED';
    r1.getCell(1).font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    for (let c = 1; c <= 18; c++) {
      const cell = r1.getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${PRIMARY_BG}` } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
    r1.height = 32;
    r1.commit();

    // ── Row 2: Document Title ────────────────────────────────────────────────
    const r2 = ws.getRow(2);
    r2.getCell(1).value = `PURCHASE ORDER — ${po.poNumber}`;
    r2.getCell(1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    for (let c = 1; c <= 18; c++) {
      const cell = r2.getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SUBHEADER_BG}` } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
    r2.height = 24;
    r2.commit();

    // ── Row 3: Blank separator ───────────────────────────────────────────────
    const r3 = ws.getRow(3);
    r3.height = 8;
    r3.commit();

    // ── Row 4-7: Order & Vendor Meta Information ─────────────────────────────
    const orderDateStr = po.orderDate ? new Date(po.orderDate).toLocaleDateString('en-GB') : '-';
    const deliveryDateStr = po.expectedDeliveryDate ? new Date(po.expectedDeliveryDate).toLocaleDateString('en-GB') : '-';

    const metaRowsData = [
      [
        'PO Number:', po.poNumber, '',
        'Vendor Name:', po.vendor?.name || 'N/A', '',
        'Order Type:', po.orderType || 'N/A', '',
        'Status:', po.status,
      ],
      [
        'Order Date:', orderDateStr, '',
        'Vendor Code:', po.vendor?.code || 'N/A', '',
        'Goods Type:', po.goodsType || 'N/A', '',
        'Ship To:', 'Logistic Area',
      ],
      [
        'Expected Delivery:', deliveryDateStr, '',
        'Vendor Email:', po.vendor?.email || 'N/A', '',
        'Vendor Contact:', po.vendor?.contactNo || 'N/A', '',
        'Vendor City:', po.vendor?.city || 'N/A',
      ],
      [
        'Maker / Prepared:', po.createdById || 'Prepared', '',
        'Checker / Checked:', po.checkedAt ? new Date(po.checkedAt).toLocaleDateString('en-GB') : 'Pending', '',
        'Authorizer / Approved:', po.authorizedAt ? new Date(po.authorizedAt).toLocaleDateString('en-GB') : 'Pending', '',
        'Export Date:', new Date().toLocaleDateString('en-GB'),
      ],
    ];

    metaRowsData.forEach((rowVals, idx) => {
      const r = ws.getRow(4 + idx);
      rowVals.forEach((val, cIdx) => {
        if (val !== '') {
          const cell = r.getCell(cIdx + 1);
          cell.value = val;
          const isLabel = cIdx % 3 === 0;
          cell.font = { bold: isLabel, size: 9, color: { argb: isLabel ? 'FF334155' : 'FF0F172A' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isLabel ? `FF${HIGHLIGHT_BG}` : 'FFFFFFFF' } };
          cell.alignment = { vertical: 'middle' };
          cell.border = {
            top:    { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
            left:   { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
            bottom: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
            right:  { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
          };
        }
      });
      r.height = 20;
      r.commit();
    });

    // ── Row 8: Blank ─────────────────────────────────────────────────────────
    const r8 = ws.getRow(8);
    r8.height = 10;
    r8.commit();

    // ── Row 9: Group Header Band ─────────────────────────────────────────────
    const r9 = ws.getRow(9);
    const groups = [
      { start: 1,  end: 12, label: 'ITEM INFORMATION',       color: '1E3A5F' },
      { start: 13, end: 14, label: 'QUANTITY',               color: '1E4D2B' },
      { start: 15, end: 18, label: 'PRICING & LINE AMOUNTS', color: '7C3A00' },
    ];
    groups.forEach((g) => {
      for (let c = g.start; c <= g.end; c++) {
        const cell = r9.getCell(c);
        if (c === g.start) cell.value = g.label;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${g.color}` } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
          top:    { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
          left:   { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
          bottom: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
          right:  { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
        };
      }
    });
    r9.height = 22;
    r9.commit();

    // ── Row 10: Column Headers ────────────────────────────────────────────────
    const headers = [
      { text: 'Line #',         align: 'center' },
      { text: 'SKU',            align: 'left' },
      { text: 'Barcode',        align: 'left' },
      { text: 'Description',    align: 'left' },
      { text: 'Brand',          align: 'left' },
      { text: 'Division',       align: 'left' },
      { text: 'Category',       align: 'left' },
      { text: 'Sub Category',   align: 'left' },
      { text: 'Gender',         align: 'center' },
      { text: 'Silhouette',     align: 'left' },
      { text: 'Color',          align: 'left' },
      { text: 'Size',           align: 'center' },
      { text: 'Ordered Qty',    align: 'right' },
      { text: 'Received Qty',   align: 'right' },
      { text: 'Unit Price (Rs)',align: 'right' },
      { text: 'Tax (%)',        align: 'right' },
      { text: 'Discount (%)',   align: 'right' },
      { text: 'Line Total (Rs)',align: 'right' },
    ];

    const r10 = ws.getRow(10);
    headers.forEach((h, idx) => {
      const cell = r10.getCell(idx + 1);
      cell.value = h.text;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      cell.font = { bold: true, color: { argb: 'FF0F172A' }, size: 9 };
      cell.alignment = { horizontal: h.align as any, vertical: 'middle' };
      cell.border = {
        top:    { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
        left:   { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
        bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
        right:  { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
      };
    });
    r10.height = 22;
    r10.commit();

    // ── Data Rows ────────────────────────────────────────────────────────────
    let totalQty = 0;
    let totalReceivedQty = 0;
    let calculatedSubtotal = 0;
    let calculatedTotal = 0;

    po.items.forEach((item, index) => {
      const lineNo = index + 1;
      const isAlt = index % 2 === 1;
      const r = ws.getRow(11 + index);

      const qty = Number(item.quantity || 0);
      const recQty = Number(item.receivedQty || 0);
      const unitPrice = Number(item.unitPrice || 0);
      const taxPercent = Number(item.taxPercent || 0);
      const discPercent = Number(item.discountPercent || 0);
      const lineTotal = Number(item.lineTotal || qty * unitPrice);

      totalQty += qty;
      totalReceivedQty += recQty;
      calculatedSubtotal += qty * unitPrice;
      calculatedTotal += lineTotal;

      const itemObj = item.item;
      const rowData = [
        lineNo,
        itemObj?.sku || '-',
        itemObj?.barCode || '-',
        item.description || itemObj?.description || '-',
        itemObj?.brand?.name || '-',
        itemObj?.division?.name || '-',
        itemObj?.category?.name || '-',
        itemObj?.subCategory?.name || '-',
        itemObj?.gender?.name || '-',
        itemObj?.silhouette?.name || '-',
        itemObj?.color?.name || '-',
        itemObj?.size?.name || '-',
        qty,
        recQty,
        unitPrice,
        taxPercent,
        discPercent,
        lineTotal,
      ];

      rowData.forEach((val, cIdx) => {
        const cell = r.getCell(cIdx + 1);
        cell.value = val;
        cell.font = { size: 9 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${isAlt ? ALT_ROW_BG : 'FFFFFF'}` } };
        cell.border = {
          top:    { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
          left:   { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
          bottom: { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
          right:  { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
        };

        if (cIdx === 0 || cIdx === 8 || cIdx === 11) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else if (cIdx >= 12) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          if (cIdx === 12 || cIdx === 13) {
            cell.numFmt = '#,##0.00';
            cell.font = { size: 9, bold: cIdx === 12, color: { argb: cIdx === 12 ? 'FF1D4ED8' : 'FF15803D' } };
          } else if (cIdx === 14 || cIdx === 17) {
            cell.numFmt = '#,##0.00';
            if (cIdx === 17) cell.font = { size: 9, bold: true, color: { argb: 'FF0F172A' } };
          } else {
            cell.numFmt = '0.00';
          }
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        }
      });

      r.height = 18;
      r.commit();
    });

    const startSummaryRow = 11 + po.items.length;

    // ── Table Summary Row ────────────────────────────────────────────────────
    const rTot = ws.getRow(startSummaryRow);
    rTot.getCell(1).value = 'TOTAL:';
    rTot.getCell(1).font = { bold: true, size: 9 };
    rTot.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };

    for (let c = 1; c <= 18; c++) {
      const cell = rTot.getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.border = {
        top:    { style: 'medium', color: { argb: 'FF0F172A' } },
        bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
        left:   { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
        right:  { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
      };
    }

    rTot.getCell(13).value = totalQty;
    rTot.getCell(13).numFmt = '#,##0.00';
    rTot.getCell(13).font = { bold: true, size: 9, color: { argb: 'FF1D4ED8' } };
    rTot.getCell(13).alignment = { horizontal: 'right', vertical: 'middle' };

    rTot.getCell(14).value = totalReceivedQty;
    rTot.getCell(14).numFmt = '#,##0.00';
    rTot.getCell(14).font = { bold: true, size: 9, color: { argb: 'FF15803D' } };
    rTot.getCell(14).alignment = { horizontal: 'right', vertical: 'middle' };

    rTot.getCell(18).value = calculatedTotal;
    rTot.getCell(18).numFmt = '#,##0.00';
    rTot.getCell(18).font = { bold: true, size: 10, color: { argb: 'FF0F172A' } };
    rTot.getCell(18).alignment = { horizontal: 'right', vertical: 'middle' };

    rTot.height = 22;
    rTot.commit();

    // ── Grand Totals & Financials Box ────────────────────────────────────────
    const subtotalVal = Number(po.subtotal || calculatedSubtotal);
    const taxVal = Number(po.taxAmount || 0);
    const discountVal = Number(po.discountAmount || 0);
    const finalTotalVal = Number(po.totalAmount || calculatedTotal);

    const finRows = [
      ['Subtotal:', subtotalVal],
      ['Tax Amount (+):', taxVal],
      ['Discount (-):', discountVal],
      ['Grand Total (Rs):', finalTotalVal],
    ];

    finRows.forEach((item, idx) => {
      const r = ws.getRow(startSummaryRow + 2 + idx);
      const isGrand = idx === 3;

      // In Words for row 1
      if (idx === 0) {
        r.getCell(1).value = 'Amount in Words:';
        r.getCell(1).font = { bold: true, size: 9 };
        r.getCell(2).value = numberToWords(finalTotalVal);
        r.getCell(2).font = { italic: true, size: 9, bold: true, color: { argb: 'FF1E3A5F' } };
      }

      r.getCell(16).value = item[0];
      r.getCell(16).font = { bold: true, size: isGrand ? 10 : 9 };
      r.getCell(16).alignment = { horizontal: 'right', vertical: 'middle' };

      r.getCell(18).value = item[1];
      r.getCell(18).font = { bold: true, size: isGrand ? 11 : 9, color: { argb: isGrand ? 'FF1E3A5F' : 'FF0F172A' } };
      r.getCell(18).numFmt = '#,##0.00';
      r.getCell(18).alignment = { horizontal: 'right', vertical: 'middle' };
      r.getCell(18).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isGrand ? 'FFE0F2FE' : 'FFF8FAFC' } };
      r.getCell(18).border = {
        top:    { style: isGrand ? 'medium' : 'thin', color: { argb: `FF${BORDER_COLOR}` } },
        bottom: { style: isGrand ? 'double' : 'thin', color: { argb: 'FF0F172A' } },
        left:   { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
        right:  { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
      };

      r.height = 20;
      r.commit();
    });

    // ── Notes & Remarks ──────────────────────────────────────────────────────
    const notesRowIdx = startSummaryRow + 7;
    const rNotes = ws.getRow(notesRowIdx);
    rNotes.getCell(1).value = 'Notes / Special Instructions:';
    rNotes.getCell(1).font = { bold: true, size: 9 };
    rNotes.height = 18;
    rNotes.commit();

    const rNotesVal = ws.getRow(notesRowIdx + 1);
    rNotesVal.getCell(1).value = po.notes || '1. Please quote PO number on all correspondence.\n2. Payment terms: As agreed.';
    rNotesVal.getCell(1).font = { size: 9, color: { argb: 'FF475569' } };
    rNotesVal.height = 24;
    rNotesVal.commit();

    // ── Signatures ───────────────────────────────────────────────────────────
    const sigRowIdx = notesRowIdx + 3;
    const rSigHeader = ws.getRow(sigRowIdx);
    rSigHeader.getCell(2).value = 'PREPARED BY (MAKER)';
    rSigHeader.getCell(8).value = 'CHECKED BY (CHECKER)';
    rSigHeader.getCell(15).value = 'APPROVED BY (AUTHORIZER)';

    [2, 8, 15].forEach((col) => {
      const cell = rSigHeader.getCell(col);
      cell.font = { bold: true, size: 9, color: { argb: 'FF0F172A' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = { top: { style: 'thin', color: { argb: 'FF0F172A' } } };
    });
    rSigHeader.height = 24;
    rSigHeader.commit();

    await workbook.commit();
  }

  /**
   * Generates a multi-PO list export sheet (with cursor pagination in chunks of 500).
   */
  private async exportPurchaseOrderList(
    prisma: PrismaService,
    job: Job<PurchaseOrderExportJobData>,
    filePath: string,
  ): Promise<void> {
    const { status, vendorId, brandId, orderType, goodsType, startDate, endDate, search } = job.data;

    const andClauses: any[] = [];
    if (status && status !== 'ALL' && status !== 'all') andClauses.push({ status });
    if (vendorId && vendorId !== 'ALL' && vendorId !== 'all') andClauses.push({ vendorId });
    if (orderType && orderType !== 'ALL' && orderType !== 'all') andClauses.push({ orderType });
    if (goodsType && goodsType !== 'ALL' && goodsType !== 'all') andClauses.push({ goodsType });

    if (brandId && brandId !== 'ALL' && brandId !== 'all') {
      andClauses.push({
        items: {
          some: {
            item: { brandId },
          },
        },
      });
    }

    if (startDate || endDate) {
      const dateFilter: any = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate)   dateFilter.lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
      andClauses.push({ orderDate: dateFilter });
    }

    if (search) {
      andClauses.push({
        OR: [
          { poNumber: { contains: search, mode: 'insensitive' } },
          { vendor: { name: { contains: search, mode: 'insensitive' } } },
        ],
      });
    }

    const where: any = andClauses.length ? { AND: andClauses } : {};
    const total = await prisma.purchaseOrder.count({ where });

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: filePath,
      useStyles: true,
      useSharedStrings: true,
    });

    const ws = workbook.addWorksheet('Purchase Orders', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
      views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }],
    });

    const columns = [
      { header: 'PO Number',         key: 'poNumber',         width: 20 },
      { header: 'Order Date',         key: 'orderDate',        width: 14, numFmt: 'dd-mmm-yyyy' },
      { header: 'Expected Date',      key: 'expectedDate',     width: 14, numFmt: 'dd-mmm-yyyy' },
      { header: 'Status',             key: 'status',           width: 16 },
      { header: 'Order Type',         key: 'orderType',        width: 14 },
      { header: 'Goods Type',         key: 'goodsType',        width: 14 },
      { header: 'Vendor Name',        key: 'vendorName',       width: 28 },
      { header: 'Vendor Code',        key: 'vendorCode',       width: 16 },
      { header: 'Total SKU Types',    key: 'itemCount',        width: 14, numFmt: '#,##0' },
      { header: 'Total Ordered Qty',  key: 'totalOrderedQty',  width: 16, numFmt: '#,##0.00' },
      { header: 'Total Received Qty', key: 'totalReceivedQty', width: 16, numFmt: '#,##0.00' },
      { header: 'Subtotal (Rs)',      key: 'subtotal',         width: 16, numFmt: '#,##0.00' },
      { header: 'Tax Amount (Rs)',    key: 'taxAmount',        width: 14, numFmt: '#,##0.00' },
      { header: 'Discount (Rs)',      key: 'discountAmount',   width: 14, numFmt: '#,##0.00' },
      { header: 'Total Amount (Rs)',  key: 'totalAmount',      width: 18, numFmt: '#,##0.00' },
    ];

    ws.columns = columns.map((c) => ({ key: c.key, width: c.width }));

    // Row 1: Header Title Band
    const r1 = ws.getRow(1);
    r1.getCell(1).value = 'PURCHASE ORDERS LIST EXPORT';
    r1.getCell(1).font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    for (let c = 1; c <= columns.length; c++) {
      const cell = r1.getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${PRIMARY_BG}` } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
    r1.height = 24;
    r1.commit();

    // Row 2: Headers
    const r2 = ws.getRow(2);
    columns.forEach((col, idx) => {
      const cell = r2.getCell(idx + 1);
      cell.value = col.header;
      cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SUBHEADER_BG}` } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top:    { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
        left:   { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
        bottom: { style: 'medium', color: { argb: `FF${BORDER_COLOR}` } },
        right:  { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
      };
    });
    r2.height = 20;
    r2.commit();

    // Data in chunks of 500
    const CHUNK = 500;
    let processed = 0;
    let rowIdx = 3;

    while (processed < total) {
      const chunk = await prisma.purchaseOrder.findMany({
        where,
        orderBy: { orderDate: 'desc' },
        skip: processed,
        take: CHUNK,
        include: {
          vendor: true,
          items: true,
        },
      });

      if (!chunk.length) break;

      for (const po of chunk) {
        const isAlt = (rowIdx % 2 === 1);
        const r = ws.getRow(rowIdx);

        const orderedQty = po.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const receivedQty = po.items.reduce((sum, item) => sum + Number(item.receivedQty || 0), 0);

        const values = [
          po.poNumber,
          po.orderDate ? new Date(po.orderDate) : null,
          po.expectedDeliveryDate ? new Date(po.expectedDeliveryDate) : null,
          po.status,
          po.orderType || '-',
          po.goodsType || '-',
          po.vendor?.name || '-',
          po.vendor?.code || '-',
          po.items.length,
          orderedQty,
          receivedQty,
          Number(po.subtotal || 0),
          Number(po.taxAmount || 0),
          Number(po.discountAmount || 0),
          Number(po.totalAmount || 0),
        ];

        values.forEach((val, cIdx) => {
          const cell = r.getCell(cIdx + 1);
          cell.value = val;
          cell.font = { size: 9 };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${isAlt ? ALT_ROW_BG : 'FFFFFF'}` } };
          cell.border = {
            top:    { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
            left:   { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
            bottom: { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
            right:  { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
          };

          if (cIdx === 0 || cIdx === 3 || cIdx === 4 || cIdx === 5 || cIdx === 7) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          } else if (cIdx === 1 || cIdx === 2) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.numFmt = 'dd-mmm-yyyy';
          } else if (cIdx >= 8) {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            cell.numFmt = cIdx === 8 ? '#,##0' : '#,##0.00';
            if (cIdx === 14) cell.font = { size: 9, bold: true };
          } else {
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
          }
        });

        r.height = 18;
        r.commit();
        rowIdx++;
      }

      processed += chunk.length;
      const progress = Math.round((processed / total) * 90);
      await job.progress(progress);
      await new Promise((resolve) => setImmediate(resolve));
    }

    await workbook.commit();
  }
}
