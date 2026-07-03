import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../database/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ExportHistoryService } from '../warehouse/export-history/export-history.service';

export interface PosSalesActivityExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  posId?: string;
  activityType?: string;
  filters?: { startDate?: string; endDate?: string; search?: string };
  locationId?: string;
}

// ── Color palette ─────────────────────────────────────────────────────────────
const SUBHEADER_BG = '1E3A5F';
const SUBHEADER_FG = 'F1F5F9';
const ALT_ROW_BG   = 'F0F4F8';
const BORDER_COLOR = 'CBD5E1';

const GROUP_COLORS: Record<string, string> = {
  'Activity Info': '1E293B',
  'Customer': '065F46',
  'Payments & Vouchers': '1E3A8A',
  'Item Details': '0F766E',
  'Financials': '581C87',
};

const COLUMNS: {
  header: string;
  key: string;
  width: number;
  group: string;
  numFmt?: string;
  align?: ExcelJS.Alignment['horizontal'];
}[] = [
  // Activity Info
  { header: 'Activity ID', key: 'activityId', width: 15, group: 'Activity Info', align: 'center' },
  { header: 'Date & Time', key: 'activityDate', width: 20, group: 'Activity Info', numFmt: 'dd-mmm-yyyy hh:mm', align: 'center' },
  { header: 'Type', key: 'activityType', width: 12, group: 'Activity Info', align: 'center' },
  { header: 'Number', key: 'activityNumber', width: 18, group: 'Activity Info', align: 'center' },
  { header: 'Parent Order #', key: 'parentOrderNumber', width: 18, group: 'Activity Info', align: 'center' },
  { header: 'Location ID', key: 'locationId', width: 15, group: 'Activity Info', align: 'center' },
  { header: 'POS ID', key: 'posId', width: 15, group: 'Activity Info', align: 'center' },
  { header: 'Cashier / Salesperson', key: 'cashierName', width: 22, group: 'Activity Info' },

  // Customer
  { header: 'Customer Name', key: 'customerName', width: 24, group: 'Customer' },
  { header: 'Customer Contact', key: 'customerContact', width: 16, group: 'Customer', align: 'center' },

  // Payments & Vouchers
  { header: 'Payment Tenders (Method: Rs. Slip#)', key: 'paymentTenders', width: 35, group: 'Payments & Vouchers' },
  { header: 'Issued Vouchers (Type: Code FaceValue)', key: 'issuedVouchers', width: 35, group: 'Payments & Vouchers' },
  { header: 'Claim Status', key: 'claimStatus', width: 14, group: 'Payments & Vouchers', align: 'center' },
  { header: 'Reason / Notes', key: 'reasonNotes', width: 25, group: 'Payments & Vouchers' },
  { header: 'Reviewer Notes', key: 'reviewNotes', width: 25, group: 'Payments & Vouchers' },

  // Item Details
  { header: 'SKU', key: 'itemSku', width: 16, group: 'Item Details', align: 'center' },
  { header: 'Description', key: 'itemDescription', width: 28, group: 'Item Details' },
  { header: 'Size', key: 'itemSize', width: 10, group: 'Item Details', align: 'center' },
  { header: 'Color', key: 'itemColor', width: 10, group: 'Item Details', align: 'center' },

  // Financials
  { header: 'Qty', key: 'quantity', width: 10, group: 'Financials', align: 'right', numFmt: '#,##0' },
  { header: 'Unit Price (Gross)', key: 'unitPrice', width: 16, group: 'Financials', align: 'right', numFmt: '#,##0.00' },
  { header: 'Tax Percent', key: 'taxPercent', width: 12, group: 'Financials', align: 'right', numFmt: '0.0%' },
  { header: 'Unit Price WOST', key: 'unitPriceWost', width: 16, group: 'Financials', align: 'right', numFmt: '#,##0.00' },
  { header: 'Line Total WOST', key: 'lineTotalWost', width: 16, group: 'Financials', align: 'right', numFmt: '#,##0.00' },
  { header: 'Discount WOST', key: 'discountWost', width: 16, group: 'Financials', align: 'right', numFmt: '#,##0.00' },
  { header: 'Tax Amount', key: 'taxAmount', width: 14, group: 'Financials', align: 'right', numFmt: '#,##0.00' },
  { header: 'Line Total (Net)', key: 'lineTotal', width: 16, group: 'Financials', align: 'right', numFmt: '#,##0.00' },
];

@Processor('pos-sales-activity-export')
export class PosSalesActivityExportProcessor {
  private readonly logger = new Logger(PosSalesActivityExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly exportHistoryService: ExportHistoryService,
  ) {}

  @Process()
  async handleExport(job: Job<PosSalesActivityExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, posId, activityType, filters, locationId } = job.data;
    this.logger.log(`[PosSalesActivityExport ${jobId}] Starting activity log export for user ${userId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
    const prismaMaster = new PrismaMasterService();

    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const filePath = path.join(exportDir, `export-${jobId}.xlsx`);

    try {
      await job.progress(5);

      const where: any = {};
      if (posId) {
        if (posId.length > 20) {
          where.terminalId = posId;
        } else {
          where.posId = posId;
        }
      }
      if (locationId) where.locationId = locationId;

      // Always exclude hold, hold_expired, and hold_cancelled orders from activity listing
      where.status = { notIn: ['hold', 'hold_expired', 'hold_cancelled'] };

      // ── Determine Date Range ──
      let start: Date | undefined = undefined;
      let end: Date | undefined = undefined;

      if (filters?.startDate) {
        start = new Date(filters.startDate);
      } else if (!filters?.search) {
        // Default to last 30 days if no start date and no search query is specified
        start = new Date();
        start.setDate(start.getDate() - 30);
        start.setHours(0, 0, 0, 0);
      }

      if (filters?.endDate) {
        end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
      } else if (!filters?.search) {
        end = new Date();
        end.setHours(23, 59, 59, 999);
      }

      // ── Gather all matching Order IDs by Activity Date ──
      const targetOrderIds = new Set<string>();
      const filterByDate = start || end;

      if (filterByDate) {
        // 1. Sale Activity in range
        const saleRangeQuery: any = {};
        if (start) saleRangeQuery.gte = start;
        if (end) saleRangeQuery.lte = end;

        const salesInRange = await prisma.salesOrder.findMany({
          where: {
            ...where,
            createdAt: saleRangeQuery,
          },
          select: { id: true },
        });
        salesInRange.forEach(o => targetOrderIds.add(o.id));

        // 2. Return/Refund Activity in range (from stock ledgers)
        const ledgerRangeQuery: any = {};
        if (start) ledgerRangeQuery.gte = start;
        if (end) ledgerRangeQuery.lte = end;

        const ledgersInRange = await prisma.stockLedger.findMany({
          where: {
            referenceType: { in: ['POS_RETURN', 'POS_REFUND'] },
            createdAt: ledgerRangeQuery,
          },
          select: { referenceId: true },
        });
        ledgersInRange.forEach(l => targetOrderIds.add(l.referenceId));

        // 3. Claim Activity in range (from claims)
        const claimRangeQuery: any = {};
        if (start) claimRangeQuery.gte = start;
        if (end) claimRangeQuery.lte = end;

        const claimsInRange = await prisma.posClaim.findMany({
          where: { submittedAt: claimRangeQuery },
          select: { salesOrderId: true },
        });
        claimsInRange.forEach(c => targetOrderIds.add(c.salesOrderId));
      }

      // ── Search Filters ──
      if (filters?.search) {
        const searchTerm = filters.search.trim();

        const searchWhere: any = {
          OR: [
            { orderNumber: { contains: searchTerm, mode: 'insensitive' } },
            { returnNumber: { contains: searchTerm, mode: 'insensitive' } },
            { refundNumber: { contains: searchTerm, mode: 'insensitive' } },
          ],
        };

        const matchedOrders = await prisma.salesOrder.findMany({
          where: {
            ...where,
            ...searchWhere,
          },
          select: { id: true },
        });
        const searchOrderIds = new Set(matchedOrders.map(o => o.id));

        // Search by Claim Number
        const matchedClaims = await prisma.posClaim.findMany({
          where: { claimNumber: { contains: searchTerm, mode: 'insensitive' } },
          select: { salesOrderId: true },
        });
        matchedClaims.forEach(c => searchOrderIds.add(c.salesOrderId));

        // Search by Voucher Code (Issued or Redeemed)
        const matchedIssuedVouchers = await prisma.voucher.findMany({
          where: { code: { contains: searchTerm, mode: 'insensitive' }, sourceOrderId: { not: null } },
          select: { sourceOrderId: true },
        });
        matchedIssuedVouchers.forEach(v => searchOrderIds.add(v.sourceOrderId as string));

        const matchedRedemptions = await prisma.voucherRedemption.findMany({
          where: { voucher: { code: { contains: searchTerm, mode: 'insensitive' } } },
          select: { orderId: true },
        });
        matchedRedemptions.forEach(r => searchOrderIds.add(r.orderId));

        // If we have date filters, intersect search results with target IDs. Else, use search results directly.
        if (filterByDate) {
          const intersectIds = Array.from(targetOrderIds).filter(id => searchOrderIds.has(id));
          targetOrderIds.clear();
          intersectIds.forEach(id => targetOrderIds.add(id));
        } else {
          searchOrderIds.forEach(id => targetOrderIds.add(id));
        }
      }

      // Apply final resolved order IDs filter
      where.id = { in: Array.from(targetOrderIds) };

      const totalOrders = await prisma.salesOrder.count({ where });
      this.logger.log(`[PosSalesActivityExport ${jobId}] Resolved ${totalOrders} parent orders matching activity filters.`);

      await job.progress(15);

      // ── Streaming workbook writer ────────────────────────────────────────
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        filename: filePath,
        useStyles: true,
        useSharedStrings: false,
      });

      const ws = workbook.addWorksheet('Sales Activities', {
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

      // ── Data rows — paginated in chunks of 500 ────────────────────
      const CHUNK = 500;
      let rowIdx = 0;
      let processed = 0;

      while (true) {
        const rawOrders = await prisma.salesOrder.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: CHUNK,
          skip: processed,
          include: {
            items: { 
              include: { 
                item: { 
                  select: { 
                    description: true, 
                    sku: true, 
                    barCode: true, 
                    size: { select: { name: true } }, 
                    color: { select: { name: true } },
                    brand: { select: { name: true } }
                  } 
                } 
              } 
            },
            customer: { select: { id: true, name: true, contactNo: true } },
            promo: { select: { name: true, code: true } },
            coupon: { select: { code: true, description: true } },
            alliance: { select: { partnerName: true, code: true, discountPercent: true, maxDiscount: true } },
            merchant: { select: { id: true, bankName: true, description: true, commissionRate: true, bankGlCode: true } },
            voucherRedemptions: { 
              select: { 
                amountUsed: true, 
                voucher: { select: { code: true, faceValue: true } } 
              } 
            },
            claims: {
              include: {
                items: {
                  include: {
                    item: { select: { description: true, sku: true, barCode: true } }
                  }
                },
                voucher: { select: { code: true, faceValue: true } }
              },
              orderBy: { submittedAt: 'desc' },
            }
          },
        });

        if (!rawOrders.length) break;

        const orderIds = rawOrders.map(o => o.id);

        // Fetch stock ledgers for returns/refunds
        const returnEntries = await prisma.stockLedger.findMany({
          where: {
            referenceType: { in: ['POS_RETURN', 'POS_REFUND'] },
            referenceId: { in: orderIds },
          },
          select: { 
            referenceId: true, 
            itemId: true, 
            qty: true, 
            referenceType: true, 
            createdAt: true 
          },
          orderBy: { createdAt: 'asc' },
        });

        const returnEntriesMap = new Map<string, typeof returnEntries>();
        for (const entry of returnEntries) {
          if (!returnEntriesMap.has(entry.referenceId)) {
            returnEntriesMap.set(entry.referenceId, []);
          }
          returnEntriesMap.get(entry.referenceId)!.push(entry);
        }

        // Fetch issued vouchers
        const issuedVouchers = await prisma.voucher.findMany({
          where: {
            sourceOrderId: { in: orderIds },
            isDeleted: false,
          },
          select: {
            id: true,
            code: true,
            voucherType: true,
            faceValue: true,
            expiresAt: true,
            sourceOrderId: true,
          }
        });

        const issuedVouchersMap = new Map<string, typeof issuedVouchers>();
        for (const v of issuedVouchers) {
          if (v.sourceOrderId) {
            if (!issuedVouchersMap.has(v.sourceOrderId)) {
              issuedVouchersMap.set(v.sourceOrderId, []);
            }
            issuedVouchersMap.get(v.sourceOrderId)!.push(v);
          }
        }

        // Fetch cashier names from master DB (using PrismaMasterService)
        const cashierIds = [...new Set(rawOrders.map(o => o.cashierUserId).filter(Boolean))] as string[];
        const cashierNameMap = new Map<string, string>();
        if (cashierIds.length) {
          const cashierUsers = await prismaMaster.user.findMany({
            where: { id: { in: cashierIds } },
            select: { id: true, firstName: true, lastName: true },
          });
          for (const u of cashierUsers) {
            cashierNameMap.set(u.id, `${u.firstName} ${u.lastName}`);
          }
        }

        // Flatten activities for this chunk
        let chunkActivities: any[] = [];
        rawOrders.forEach(order => {
          const orderVouchers = issuedVouchersMap.get(order.id) || [];
          const orderLedgers = returnEntriesMap.get(order.id) || [];
          const cashierName = order.cashierUserId ? (cashierNameMap.get(order.cashierUserId) || 'Unknown') : 'Unknown';

          // 1. Sale Activity
          const saleIssuedVouchers = orderVouchers.filter(v => ['GIFT', 'CREDIT'].includes(v.voucherType));
          const tenders: { method: string; amount: number; slipNo?: string }[] = [];
          const voucherTotalFromRedemptions = (order.voucherRedemptions || []).reduce(
            (sum: number, r: any) => sum + Number(r.amountUsed), 0
          );
          for (const r of (order.voucherRedemptions || []) as any[]) {
            tenders.push({ method: 'voucher', amount: Number(r.amountUsed), slipNo: r.voucher?.code || undefined });
          }

          if (order.tenderType === 'split') {
            if (Number(order.cashAmount) > 0) tenders.push({ method: 'cash', amount: Number(order.cashAmount) });
            const isLegacy = order.voucherAmount === null || order.voucherAmount === undefined;
            const realCardAmount = isLegacy
              ? Math.max(0, Number(order.cardAmount) - voucherTotalFromRedemptions - Number(order.changeAmount ?? 0))
              : Number(order.cardAmount);
            if (realCardAmount > 0) tenders.push({ method: 'card', amount: realCardAmount });
          } else if (order.paymentMethod) {
            if (voucherTotalFromRedemptions > 0) {
              const totalOrder = Number(order.grandTotal);
              const remaining = totalOrder - voucherTotalFromRedemptions;
              if (remaining > 0) tenders.push({ method: order.paymentMethod, amount: remaining });
            } else {
              const amount = Number(order.cashAmount) || Number(order.cardAmount) || Number(order.grandTotal);
              tenders.push({ method: order.paymentMethod, amount });
            }
          }

          chunkActivities.push({
            id: `${order.id}-sale`,
            type: 'sale',
            number: order.orderNumber,
            date: order.createdAt,
            amount: Number(order.grandTotal),
            orderId: order.id,
            orderNumber: order.orderNumber,
            locationId: order.locationId,
            posId: order.posId || order.terminalId,
            customer: order.customer,
            cashierName,
            tenders,
            issuedVouchers: saleIssuedVouchers.map(v => ({
              code: v.code,
              faceValue: Number(v.faceValue),
              voucherType: v.voucherType,
              expiresAt: v.expiresAt
            })),
            items: order.items.map((oi: any) => ({
              itemId: oi.itemId,
              sku: oi.item?.sku || oi.item?.barCode || 'N/A',
              description: oi.item?.description || 'Item',
              quantity: oi.quantity,
              price: Number(oi.unitPrice),
              lineTotal: Number(oi.lineTotal),
              size: oi.item?.size?.name,
              color: oi.item?.color?.name,
              taxPercent: Number(oi.taxPercent || 0),
              taxAmount: Number(oi.taxAmount || 0),
              discountAmount: Number(oi.discountAmount || 0),
            }))
          });

          // 2. Return Activity
          const returnLedgers = orderLedgers.filter(l => l.referenceType === 'POS_RETURN');
          if (order.returnNumber || returnLedgers.length > 0) {
            const exchangeVoucher = orderVouchers.find(v => v.voucherType === 'EXCHANGE');
            const returnDate = returnLedgers.length > 0 ? returnLedgers[returnLedgers.length - 1].createdAt : order.updatedAt;

            const returnedItems = returnLedgers.map(l => {
              const orderItem = order.items.find((oi: any) => oi.itemId === l.itemId);
              return {
                itemId: l.itemId,
                sku: orderItem?.item?.sku || orderItem?.item?.barCode || 'N/A',
                description: orderItem?.item?.description || 'Item',
                quantity: Math.abs(Number(l.qty)),
                price: orderItem ? Number(orderItem.unitPrice) : 0,
                lineTotal: orderItem ? Math.abs(Number(l.qty)) * Number(orderItem.unitPrice) : 0,
                size: orderItem?.item?.size?.name,
                color: orderItem?.item?.color?.name,
                taxPercent: orderItem ? Number(orderItem.taxPercent || 0) : 0,
                taxAmount: orderItem ? (Math.abs(Number(l.qty)) / Number(orderItem.quantity)) * Number(orderItem.taxAmount || 0) : 0,
                discountAmount: orderItem ? (Math.abs(Number(l.qty)) / Number(orderItem.quantity)) * Number(orderItem.discountAmount || 0) : 0,
              };
            });

            chunkActivities.push({
              id: `${order.id}-return`,
              type: 'return',
              number: order.returnNumber || 'Return',
              date: returnDate,
              amount: exchangeVoucher ? Number(exchangeVoucher.faceValue) : returnedItems.reduce((s, i) => s + i.lineTotal, 0),
              orderId: order.id,
              orderNumber: order.orderNumber,
              locationId: order.locationId,
              posId: order.posId || order.terminalId,
              customer: order.customer,
              cashierName,
              items: returnedItems,
              issuedVouchers: exchangeVoucher ? [{
                code: exchangeVoucher.code,
                faceValue: Number(exchangeVoucher.faceValue),
                voucherType: 'EXCHANGE',
                expiresAt: exchangeVoucher.expiresAt
              }] : []
            });
          }

          // 3. Refund Activity
          const refundLedgers = orderLedgers.filter(l => l.referenceType === 'POS_REFUND');
          if (order.refundNumber || refundLedgers.length > 0) {
            const refundVouchers = orderVouchers.filter(v => ['REFUND', 'CREDIT'].includes(v.voucherType) && !saleIssuedVouchers.some(sv => sv.id === v.id));
            const refundDate = refundLedgers.length > 0 ? refundLedgers[refundLedgers.length - 1].createdAt : order.updatedAt;

            const refundedItems = refundLedgers.map(l => {
              const orderItem = order.items.find((oi: any) => oi.itemId === l.itemId);
              return {
                itemId: l.itemId,
                sku: orderItem?.item?.sku || orderItem?.item?.barCode || 'N/A',
                description: orderItem?.item?.description || 'Item',
                quantity: Math.abs(Number(l.qty)),
                price: orderItem ? Number(orderItem.unitPrice) : 0,
                lineTotal: orderItem ? Math.abs(Number(l.qty)) * Number(orderItem.unitPrice) : 0,
                size: orderItem?.item?.size?.name,
                color: orderItem?.item?.color?.name,
                taxPercent: orderItem ? Number(orderItem.taxPercent || 0) : 0,
                taxAmount: orderItem ? (Math.abs(Number(l.qty)) / Number(orderItem.quantity)) * Number(orderItem.taxAmount || 0) : 0,
                discountAmount: orderItem ? (Math.abs(Number(l.qty)) / Number(orderItem.quantity)) * Number(orderItem.discountAmount || 0) : 0,
              };
            });

            chunkActivities.push({
              id: `${order.id}-refund`,
              type: 'refund',
              number: order.refundNumber || 'Refund',
              date: refundDate,
              amount: refundVouchers.length > 0 ? refundVouchers.reduce((sum, v) => sum + Number(v.faceValue), 0) : refundedItems.reduce((s, i) => s + i.lineTotal, 0),
              orderId: order.id,
              orderNumber: order.orderNumber,
              locationId: order.locationId,
              posId: order.posId || order.terminalId,
              customer: order.customer,
              cashierName,
              items: refundedItems,
              issuedVouchers: refundVouchers.map(v => ({
                code: v.code,
                faceValue: Number(v.faceValue),
                voucherType: v.voucherType,
                expiresAt: v.expiresAt
              }))
            });
          }

          // 4. Claim Activities
          for (const claim of order.claims || []) {
            chunkActivities.push({
              id: claim.id,
              type: 'claim',
              number: claim.claimNumber,
              date: claim.submittedAt,
              status: claim.status,
              amount: Number(claim.claimedAmount),
              approvedAmount: Number(claim.approvedAmount),
              reasonNotes: claim.reasonNotes,
              reviewNotes: claim.reviewNotes,
              orderId: order.id,
              orderNumber: order.orderNumber,
              locationId: order.locationId,
              posId: order.posId || order.terminalId,
              customer: order.customer,
              cashierName,
              issuedVouchers: claim.voucher ? [{
                code: claim.voucher.code,
                faceValue: Number(claim.voucher.faceValue),
                voucherType: 'EXCHANGE',
                expiresAt: (claim.voucher as any).expiresAt
              }] : [],
              items: claim.items.map((ci: any) => {
                const orderItem = order.items.find((oi: any) => oi.itemId === ci.itemId);
                return {
                  itemId: ci.itemId,
                  sku: ci.item?.sku || ci.item?.barCode || 'N/A',
                  description: ci.item?.description || 'Item',
                  quantity: ci.claimedQty,
                  approvedQty: ci.approvedQty,
                  price: Number(ci.unitPaidPrice),
                  lineTotal: Number(ci.claimedAmount),
                  approvedAmount: Number(ci.approvedAmount),
                  status: ci.itemStatus,
                  taxPercent: orderItem ? Number(orderItem.taxPercent || 0) : 0,
                  taxAmount: orderItem ? (Number(ci.claimedQty) / Number(orderItem.quantity)) * Number(orderItem.taxAmount || 0) : 0,
                  discountAmount: orderItem ? (Number(ci.claimedQty) / Number(orderItem.quantity)) * Number(orderItem.discountAmount || 0) : 0,
                };
              })
            });
          }
        });

        // ── In-Memory Filtering on this Chunk ──
        if (start || end) {
          chunkActivities = chunkActivities.filter(act => {
            const actTime = new Date(act.date).getTime();
            if (start && actTime < start.getTime()) return false;
            if (end && actTime > end.getTime()) return false;
            return true;
          });
        }

        if (activityType && activityType !== 'all') {
          if (activityType === 'exchange') {
            chunkActivities = chunkActivities.filter(act => 
              act.type === 'return' || (act.type === 'claim' && act.claimType === 'EXCHANGE')
            );
          } else {
            chunkActivities = chunkActivities.filter(act => act.type === activityType);
          }
        }

        // Write chunk activities to worksheet
        for (const act of chunkActivities) {
          if (act.items && act.items.length > 0) {
            for (const it of act.items) {
              const isAlt = rowIdx % 2 === 1;

              // Format tenders
              let tendersStr = '';
              if (act.tenders && act.tenders.length > 0) {
                tendersStr = act.tenders.map((tend: any) => {
                  let term = `${tend.method.toUpperCase()}: Rs. ${Number(tend.amount).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
                  if (tend.slipNo) term += ` (#${tend.slipNo})`;
                  return term;
                }).join(', ');
              }

              // Format issued vouchers
              let issuedVouchersStr = '';
              if (act.issuedVouchers && act.issuedVouchers.length > 0) {
                issuedVouchersStr = act.issuedVouchers.map((v: any) => {
                  return `${v.voucherType}: ${v.code} (Rs. ${Number(v.faceValue).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 })})`;
                }).join(', ');
              }

              const qty = act.type === 'sale' ? Number(it.quantity) : -Number(it.quantity);
              const unitPrice = Number(it.price);
              const lineTotal = act.type === 'sale' ? Number(it.lineTotal) : -Number(it.lineTotal);
              const taxPercent = Number(it.taxPercent || 0);
              const taxAmount = act.type === 'sale' ? Number(it.taxAmount || 0) : -Number(it.taxAmount || 0);
              const discountAmount = act.type === 'sale' ? Number(it.discountAmount || 0) : -Number(it.discountAmount || 0);

              const taxDivisor = 1 + (taxPercent / 100);
              const unitPriceWost = unitPrice / taxDivisor;
              const lineTotalWost = lineTotal / taxDivisor;
              const discountWost = discountAmount / taxDivisor;

              const rowData: Record<string, any> = {
                activityId: act.id,
                activityDate: new Date(act.date),
                activityType: act.type.toUpperCase(),
                activityNumber: act.number,
                parentOrderNumber: act.type !== 'sale' ? act.orderNumber : '',
                locationId: act.locationId,
                posId: act.posId,
                cashierName: act.cashierName,
                customerName: act.customer?.name || 'Walk-in Customer',
                customerContact: act.customer?.contactNo || '',
                paymentTenders: tendersStr,
                issuedVouchers: issuedVouchersStr,
                claimStatus: act.status || '',
                reasonNotes: act.reasonNotes || '',
                reviewNotes: act.reviewNotes || '',
                itemSku: it.sku,
                itemDescription: it.description,
                itemSize: it.size || '',
                itemColor: it.color || '',
                quantity: qty,
                unitPrice: unitPrice,
                taxPercent: taxPercent / 100,
                unitPriceWost: unitPriceWost,
                lineTotalWost: lineTotalWost,
                discountWost: discountWost,
                taxAmount: taxAmount,
                lineTotal: lineTotal,
              };

              const dataRow = ws.getRow(rowIdx + 3);
              COLUMNS.forEach((col, colIdx) => {
                const cell = dataRow.getCell(colIdx + 1);
                cell.value = rowData[col.key] ?? null;
                if (col.numFmt) cell.numFmt = col.numFmt;
                cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${isAlt ? ALT_ROW_BG : 'FFFFFF'}` } };
                cell.font = { size: 9 };
                cell.border = {
                  top: { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
                  left: { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
                  bottom: { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
                  right: { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
                };
              });
              dataRow.height = 16;
              dataRow.commit();
              rowIdx++;
            }
          }
        }

        processed += rawOrders.length;
        const pct = totalOrders > 0 ? Math.round((processed / totalOrders) * 95) : 50;
        await job.progress(pct);
        await new Promise((r) => setImmediate(r));

        if (rawOrders.length < CHUNK) break;
      }

      // Summary worksheet
      const summary = workbook.addWorksheet('Summary');
      summary.columns = [{ key: 'label', width: 28 }, { key: 'value', width: 32 }];

      const titleRow = summary.getRow(1);
      titleRow.getCell(1).value = 'POS Sales Activities Export Summary';
      titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: 'FF1E293B' } };
      titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      titleRow.height = 28;
      titleRow.commit();

      const summaryRows = [
        ['Export Date', new Date().toLocaleString('en-PK')],
        ['Total Parent Orders Processed', totalOrders],
        ['Total Line Items Exported', rowIdx],
        ['Search Query', filters?.search ?? '(none)'],
        ['Start Date Filter', filters?.startDate ? new Date(filters.startDate).toLocaleDateString() : '(all)'],
        ['End Date Filter', filters?.endDate ? new Date(filters.endDate).toLocaleDateString() : '(all)'],
        ['Activity Type Filter', activityType ?? 'ALL'],
      ];
      summaryRows.forEach(([label, value], idx) => {
        const r = summary.getRow(idx + 2);
        r.getCell(1).value = label;
        r.getCell(1).font = { bold: true, size: 10 };
        r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF' } };
        r.getCell(2).value = value;
        r.getCell(2).font = { size: 10 };
        r.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF' } };
        r.height = 18;
        r.commit();
      });

      await workbook.commit();

      // Complete and upload export
      await this.exportHistoryService.completeAndUploadExport(
        prisma,
        jobId,
        filePath,
        `pos-sales-activity-export-${new Date().toISOString().slice(0, 10)}.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      await job.progress(100);
      this.logger.log(`[PosSalesActivityExport ${jobId}] Finished processing successfully (${rowIdx} rows)`);

      await this.notificationsService.create({
        userId,
        title: 'POS Sales Activity Export Ready',
        message: `Your export of ${rowIdx.toLocaleString()} activity lines is ready to download.`,
        category: 'export',
        priority: 'high',
        actionType: 'pos-sales-activity-export.ready',
        actionPayload: JSON.stringify({ jobId }),
        entityType: 'pos-sales-activity-export',
        entityId: jobId,
        channels: ['inApp'],
      });

    } catch (error: any) {
      this.logger.error(`[PosSalesActivityExport ${jobId}] FAILED: ${error.message}`, error.stack);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {}
      }

      await this.exportHistoryService.failExport(prisma, jobId);

      await this.notificationsService.create({
        userId,
        title: 'POS Sales Activity Export Failed',
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
