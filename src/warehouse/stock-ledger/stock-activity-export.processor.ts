import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { MovementType } from '@prisma/client';
import { ExportHistoryService } from '../export-history/export-history.service';
import { chunkArray } from '../../common/utils/chunk.util';


import { StockActivityExportService } from './stock-activity-export.service';

export interface StockActivityExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  locationId?: string;
  warehouseId?: string;
  startDate?: string;
  endDate?: string;
  reportType?: 'merged' | 'separate' | 'detailed';
  format: 'xlsx' | 'pdf';
  summaryOnly?: boolean;
  showBrand?: boolean;
  showDivision?: boolean;
  showCategory?: boolean;
  showGender?: boolean;
  showSilhouette?: boolean;
  showArticle?: boolean;
  showVariant?: boolean;
}

export interface StockActivityPreviewJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  locationId?: string;
  warehouseId?: string;
  startDate?: string;
  endDate?: string;
  reportType?: 'merged' | 'separate' | 'detailed';
  search?: string;
}

const GROUP_COLORS: Record<string, string> = {
  General: '1E293B',
  'Transfer IN': '065F46',
  'Transfer OUT': '991B1B',
  Movements: '5B21B6',
  Balances: '1E3A8A',
};

const COLUMNS = [
  { header: 'SKU / Variant Info', key: 'sku', width: 32, group: 'General' },
  { header: 'Color', key: 'color', width: 14, group: 'General', align: 'center' as const },
  { header: 'Size', key: 'size', width: 10, group: 'General', align: 'center' as const },
  { header: 'Opening', key: 'bf', width: 14, group: 'General', align: 'right' as const },
  { header: 'Wh IN', key: 'fromWarehouse', width: 12, group: 'Transfer IN', align: 'right' as const },
  { header: 'Outlet IN', key: 'fromOutlet', width: 12, group: 'Transfer IN', align: 'right' as const },
  { header: 'Total IN', key: 'totalTrfIn', width: 14, group: 'Transfer IN', align: 'right' as const },
  { header: 'Wh OUT', key: 'toWarehouse', width: 12, group: 'Transfer OUT', align: 'right' as const },
  { header: 'Outlet OUT', key: 'toOutlet', width: 12, group: 'Transfer OUT', align: 'right' as const },
  { header: 'Total OUT', key: 'totalTrfOut', width: 14, group: 'Transfer OUT', align: 'right' as const },
  { header: 'Exchg', key: 'exchg', width: 12, group: 'Movements', align: 'right' as const },
  { header: 'Refund', key: 'refund', width: 12, group: 'Movements', align: 'right' as const },
  { header: 'Claim', key: 'claim', width: 12, group: 'Movements', align: 'right' as const },
  { header: 'Sales', key: 'sales', width: 12, group: 'Movements', align: 'right' as const },
  { header: 'Adj', key: 'adj', width: 12, group: 'Movements', align: 'right' as const },
  { header: 'Available', key: 'availableStock', width: 14, group: 'Balances', align: 'right' as const },
  { header: 'Transit', key: 'transit', width: 12, group: 'Balances', align: 'right' as const },
  { header: 'Balance', key: 'balance', width: 16, group: 'Balances', align: 'right' as const },
];

const DETAILED_COLUMNS = [
  { header: 'SKU / Variant Info', key: 'sku', width: 32, group: 'General' },
  { header: 'Color', key: 'color', width: 14, group: 'General', align: 'center' as const },
  { header: 'Size', key: 'size', width: 10, group: 'General', align: 'center' as const },
  { header: 'Opening', key: 'bf', width: 14, group: 'General', align: 'right' as const },
  { header: 'Purchases', key: 'purchases', width: 12, group: 'Transfer IN', align: 'right' as const },
  { header: 'Purchase Ret', key: 'purchaseReturn', width: 12, group: 'Transfer IN', align: 'right' as const },
  { header: 'From Outlet', key: 'fromOutlet', width: 12, group: 'Transfer IN', align: 'right' as const },
  { header: 'To Outlet', key: 'toOutlet', width: 12, group: 'Transfer OUT', align: 'right' as const },
  { header: 'Delivery Challan', key: 'deliveryChallan', width: 14, group: 'Transfer OUT', align: 'right' as const },
  { header: 'Wholesale Ret', key: 'wholesaleReturn', width: 14, group: 'Transfer OUT', align: 'right' as const },
  { header: 'Adj', key: 'adj', width: 12, group: 'Movements', align: 'right' as const },
  { header: 'Available', key: 'availableStock', width: 14, group: 'Balances', align: 'right' as const },
  { header: 'Reserved SO', key: 'reservedSO', width: 12, group: 'Balances', align: 'right' as const },
  { header: 'Reserved SRN', key: 'reservedSRN', width: 12, group: 'Balances', align: 'right' as const },
  { header: 'Total Reserved', key: 'totalReserved', width: 14, group: 'Balances', align: 'right' as const },
  { header: 'Stock After Res', key: 'stockAfterRes', width: 14, group: 'Balances', align: 'right' as const },
  { header: 'Transit GRN', key: 'transitGRN', width: 14, group: 'Balances', align: 'right' as const },
  { header: 'Transit', key: 'transit', width: 12, group: 'Balances', align: 'right' as const },
  { header: 'Balance', key: 'balance', width: 16, group: 'Balances', align: 'right' as const },
];

@Processor('stock-activity-export')
export class StockActivityExportProcessor {
  private readonly logger = new Logger(StockActivityExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly exportHistoryService: ExportHistoryService,
    private readonly stockActivityExportService: StockActivityExportService,
  ) {
    if (process.platform === 'linux') {
      try {
        const logger = new Logger('StockActivityExportProcessor');
        logger.log('Checking and installing Chromium dependencies on Linux host...');
        const { exec } = require('child_process');
        exec(
          'apt-get update && apt-get install -y libatk1.0-0 libatk-bridge2.0-0 libcups2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpangocairo-1.0-0 libasound2 libnss3 libxshmfence1 libgtk-3-0',
          (err: any) => {
            if (err) {
              logger.warn(`Could not install Chromium dependencies automatically: ${err.message}. If not running as root, please install them manually: apt-get install -y libatk1.0-0 libatk-bridge2.0-0 libcups2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpangocairo-1.0-0 libasound2 libnss3 libxshmfence1 libgtk-3-0`);
            } else {
              logger.log('Chromium dependencies verified/installed successfully.');
            }
          }
        );
      } catch (e: any) {
        this.logger.warn(`Error trying to run chromium dependencies installer: ${e.message}`);
      }
    }
  }

  @Process('generate-stock-activity-preview')
  async handleGeneratePreview(job: Job<StockActivityPreviewJobData>): Promise<void> {
    const { jobId, tenantId, tenantDbUrl, locationId, warehouseId, startDate, endDate, reportType, search } = job.data;
    this.logger.log(`[StockActivityPreview ${jobId}] Starting background stock-activity preview computation (mode: ${reportType || 'merged'})`);

    const prisma = (tenantId && tenantDbUrl)
      ? PrismaService.getTenantClient(tenantId, tenantDbUrl)
      : new PrismaService({ tenantId, tenantDbUrl } as any);

    try {
      await job.progress({ percent: 10, message: 'Queueing preview computation task...' });

      const result = await this.stockActivityExportService.generateStockActivityReportDataInternal(
        prisma as any,
        {
          locationId,
          warehouseId,
          startDate,
          endDate,
          reportType,
          search,
          onProgress: async (percent, message) => {
            await job.progress({ percent, message });
          },
        },
      );

      await this.stockActivityExportService.saveReportPreviewResult(jobId, result);
      await job.progress({ percent: 100, message: 'Stock Activity report preview ready!' });
      this.logger.log(`[StockActivityPreview ${jobId}] Successfully generated and saved preview result`);
    } catch (err: any) {
      this.logger.error(`[StockActivityPreview ${jobId}] Failed to compute preview: ${err.message}`, err.stack);
      throw err;
    }
  }

  @Process({ concurrency: 1 })
  async handleExport(job: Job<StockActivityExportJobData>): Promise<void> {
    const {
      jobId, userId, tenantId, tenantDbUrl, locationId, warehouseId, startDate: startStr, endDate: endStr, format, summaryOnly,
      showBrand, showDivision, showCategory, showGender, showSilhouette, showArticle, showVariant, reportType = 'merged',
    } = job.data;
    this.logger.log(`[StockActivityExport ${jobId}] Starting ${format.toUpperCase()} export for user ${userId}`);

    const prisma = (tenantId && tenantDbUrl)
      ? PrismaService.getTenantClient(tenantId, tenantDbUrl)
      : new PrismaService({ tenantId, tenantDbUrl } as any);
    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    const filePath = path.join(exportDir, `export-${jobId}.${ext}`);

    try {
      await job.progress(5);

      const locIds = locationId ? locationId.split(',').map(s => s.trim()).filter(Boolean) : [];
      const locationWhere = locIds.length > 1 ? { in: locIds } : (locIds.length === 1 ? locIds[0] : undefined);

      const whIds = warehouseId ? warehouseId.split(',').map(s => s.trim()).filter(Boolean) : [];
      const warehouseWhere = whIds.length > 1 ? { in: whIds } : (whIds.length === 1 ? whIds[0] : undefined);

      const [allLocations, allWarehouses] = await Promise.all([
        prisma.location.findMany({ select: { id: true, name: true, code: true } }),
        prisma.warehouse.findMany({ select: { id: true, name: true, code: true } }),
      ]);

      let locationOrWarehouseWhere: any = {};
      let locationName = '';

      if (reportType === 'detailed') {
        const c40001Wh = allWarehouses.find((w: any) => w.code === 'C40001') || allWarehouses[0];
        const targetWhIds = whIds.length > 0 ? whIds : (c40001Wh ? [c40001Wh.id] : []);
        const warehouseWhere = targetWhIds.length > 1 ? { in: targetWhIds } : targetWhIds.length === 1 ? targetWhIds[0] : undefined;

        locationOrWarehouseWhere = warehouseWhere
          ? { warehouseId: warehouseWhere, locationId: null }
          : { warehouseId: { not: null }, locationId: null };

        const matchedWhs = allWarehouses.filter((w) => targetWhIds.includes(w.id));
        locationName = matchedWhs.length > 0 ? matchedWhs.map((w) => `${w.name} (${w.code || 'WH'})`).join(', ') : 'Central Warehouse (C40001)';
      } else {
        const storeLocations = allLocations.filter(
          (l) => l.code !== 'C40001' && l.code !== 'WH-C40001' && !l.name.includes('LOGISTIC AREA'),
        );
        const storeLocIds = storeLocations.map((l) => l.id);
        const nonC40001Warehouses = allWarehouses.filter((w) => w.code !== 'C40001');
        const nonC40001WhIds = nonC40001Warehouses.map((w) => w.id);

        const actualLocIds = locIds
          .filter((id) => !id.startsWith('wh:'))
          .filter((id) => storeLocIds.includes(id));
        const passedWhIds = [
          ...whIds,
          ...locIds.filter((id) => id.startsWith('wh:')).map((id) => id.replace('wh:', '')),
        ].filter((id) => nonC40001WhIds.includes(id));

        if (actualLocIds.length > 0 || passedWhIds.length > 0) {
          const orConds: any[] = [];
          if (actualLocIds.length > 0) {
            orConds.push({ locationId: actualLocIds.length > 1 ? { in: actualLocIds } : actualLocIds[0] });
          }
          if (passedWhIds.length > 0) {
            orConds.push({
              warehouseId: passedWhIds.length > 1 ? { in: passedWhIds } : passedWhIds[0],
              locationId: null,
            });
          }
          locationOrWarehouseWhere = orConds.length > 1 ? { OR: orConds } : (orConds.length === 1 ? orConds[0] : {});

          const selectedLocNames = storeLocations.filter((l) => actualLocIds.includes(l.id)).map((l) => l.name);
          const selectedWhNames = nonC40001Warehouses.filter((w) => passedWhIds.includes(w.id)).map((w) => `${w.name} (Warehouse)`);
          locationName = [...selectedLocNames, ...selectedWhNames].join(', ');
        } else {
          locationOrWarehouseWhere = {
            OR: [
              { locationId: { in: storeLocIds } },
              { warehouseId: { in: nonC40001WhIds }, locationId: null },
            ],
          };
          locationName = 'All Outlets & Warehouses';
        }
      }

      const now = new Date();
      const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = endStr ? new Date(endStr) : new Date(now);

      await job.progress(10);

      // Fetch inventory item ids
      const inventoryItems = await prisma.inventoryItem.findMany({
        where: {
          ...locationOrWarehouseWhere,
          status: 'AVAILABLE',
        },
        select: { itemId: true },
      });

      const ledgerItems = await prisma.stockLedger.findMany({
        where: locationOrWarehouseWhere,
        select: { itemId: true },
        distinct: ['itemId'],
      });

      const uniqueItemIds = [...new Set([
        ...inventoryItems.map(i => i.itemId),
        ...ledgerItems.map(l => l.itemId),
      ])];

      if (uniqueItemIds.length === 0) {
        const selectedColumns = reportType === 'detailed' ? DETAILED_COLUMNS : COLUMNS;
        if (format === 'xlsx') {
          await this.writeEmptyWorkbook(filePath, selectedColumns);
        } else {
          await this.writeEmptyPdf(filePath, locationName, startDate, endDate);
        }
        await job.progress(100);
        return;
      }

      await job.progress(20);

      const uniqueItemChunks = chunkArray(uniqueItemIds, 1000);
      const itemsNested = await Promise.all(
        uniqueItemChunks.map((chunk) =>
          prisma.item.findMany({
            where: {
              OR: [
                { id: { in: chunk } },
                { itemId: { in: chunk } },
              ],
            },
            include: {
              color: true,
              size: true,
              gender: true,
              category: true,
              division: true,
              brand: true,
              silhouette: true,
            },
          }),
        ),
      );
      const items = itemsNested.flat();

      await job.progress(45);

      const matchedItemIds = items.map(i => i.id);
      const matchedItemChunks = chunkArray(matchedItemIds, 1000);

      const bfMap = new Map<string, number>();
      for (const chunk of matchedItemChunks) {
        const bfGroup = await prisma.stockLedger.groupBy({
          by: ['itemId'],
          where: {
            AND: [
              locationOrWarehouseWhere,
              {
                itemId: { in: chunk },
                createdAt: { lt: startDate },
              },
            ],
          },
          _sum: { qty: true },
        });

        for (const row of bfGroup) {
          bfMap.set(row.itemId, Number(row._sum.qty || 0));
        }

        const inRangeOpeningGroup = await prisma.stockLedger.groupBy({
          by: ['itemId'],
          where: {
            AND: [
              locationOrWarehouseWhere,
              {
                itemId: { in: chunk },
                createdAt: { gte: startDate, lte: endDate },
                OR: [
                  { movementType: MovementType.OPENING_BALANCE },
                  { referenceType: 'OPENING_BALANCE' },
                  { referenceType: 'BULK_STOCK_UPLOAD' },
                  { referenceType: 'FISCAL_YEAR_OPENING' },
                ],
              },
            ],
          },
          _sum: { qty: true },
        });

        for (const row of inRangeOpeningGroup) {
          const currentBf = bfMap.get(row.itemId) || 0;
          bfMap.set(row.itemId, currentBf + Number(row._sum.qty || 0));
        }
      }

      const ledgerEntries: any[] = [];
      for (const chunk of matchedItemChunks) {
        const chunkEntries = await prisma.stockLedger.findMany({
          where: {
            AND: [
              locationOrWarehouseWhere,
              {
                itemId: { in: chunk },
                createdAt: { gte: startDate, lte: endDate },
                NOT: [
                  { movementType: MovementType.OPENING_BALANCE },
                  { referenceType: 'OPENING_BALANCE' },
                  { referenceType: 'BULK_STOCK_UPLOAD' },
                  { referenceType: 'FISCAL_YEAR_OPENING' },
                ],
              },
            ],
          },
          select: {
            itemId: true,
            qty: true,
            referenceType: true,
            referenceId: true,
            movementType: true,
          },
        });
        ledgerEntries.push(...chunkEntries);
      }

      const toLocOrWhFilters: any[] = [];
      if (locationWhere) toLocOrWhFilters.push({ toLocationId: locationWhere });
      if (warehouseWhere) toLocOrWhFilters.push({ toWarehouseId: warehouseWhere });

      const toLocOrWhWhere = toLocOrWhFilters.length > 1
        ? { OR: toLocOrWhFilters }
        : (toLocOrWhFilters.length === 1 ? toLocOrWhFilters[0] : {});

      const transitItems: any[] = [];
      for (const chunk of matchedItemChunks) {
        const chunkTransit = await prisma.transferRequestItem.findMany({
          where: {
            itemId: { in: chunk },
            transferRequest: {
              ...toLocOrWhWhere,
              status: { in: ['PENDING', 'SOURCE_APPROVED'] },
              transferType: { in: ['WAREHOUSE_TO_OUTLET', 'OUTLET_TO_OUTLET', 'OUTLET_TO_WAREHOUSE', 'WAREHOUSE_TO_WAREHOUSE'] },
            },
          },
          select: {
            itemId: true,
            quantity: true,
          },
        });
        transitItems.push(...chunkTransit);
      }

      const transitMap = new Map<string, number>();
      for (const row of transitItems) {
        const qty = Number(row.quantity || 0);
        transitMap.set(row.itemId, (transitMap.get(row.itemId) || 0) + qty);
      }

      const centralWh = await prisma.warehouse.findFirst({
        where: { code: 'C40001' },
        select: { id: true },
      });
      const centralWhId = centralWh?.id;
      const isCentralWarehouseScope = warehouseId === centralWhId;

      const transferRefs = [
        'TRANSFER_REQUEST',
        'TRANSFER_IN',
        'TRANSFER_OUT',
        'OUTLET_TRANSFER_IN',
        'OUTLET_TRANSFER_OUT',
        'RETURN_REQUEST',
        'CLAIM_RETURN',
        'CLAIM_TO_PLM',
        'CLAIM_RETURN_REQUEST',
      ];
      const transferRefIds = [
        ...new Set(
          ledgerEntries
            .filter((e) => transferRefs.includes(e.referenceType))
            .map((e) => e.referenceId)
            .filter(Boolean),
        ),
      ];

      const trMap = new Map<
        string,
        { fromWarehouseId: string | null; toWarehouseId: string | null; transferType: string }
      >();
      if (transferRefIds.length > 0) {
        const trChunks = chunkArray(transferRefIds, 1000);
        const trsNested = await Promise.all(
          trChunks.map((chunk) =>
            prisma.transferRequest.findMany({
              where: {
                OR: [{ id: { in: chunk } }, { requestNo: { in: chunk } }],
              },
              select: {
                id: true,
                requestNo: true,
                fromWarehouseId: true,
                toWarehouseId: true,
                transferType: true,
              },
            }),
          ),
        );
        for (const tr of trsNested.flat()) {
          const meta = {
            fromWarehouseId: tr.fromWarehouseId,
            toWarehouseId: tr.toWarehouseId,
            transferType: tr.transferType,
          };
          trMap.set(tr.id, meta);
          trMap.set(tr.requestNo, meta);
        }
      }

      await job.progress(60);

      const itemMetricsMap = new Map<string, {
        fromWarehouse: number;
        fromOutlet: number;
        toWarehouse: number;
        toOutlet: number;
        exchg: number;
        refund: number;
        claim: number;
        sales: number;
        adj: number;
        purchases: number;
        purchaseReturn: number;
        deliveryChallan: number;
        wholesaleReturn: number;
      }>();

      for (const entry of ledgerEntries) {
        const itemId = entry.itemId;
        let m = itemMetricsMap.get(itemId);
        if (!m) {
          m = {
            fromWarehouse: 0, fromOutlet: 0, toWarehouse: 0, toOutlet: 0,
            exchg: 0, refund: 0, claim: 0, sales: 0, adj: 0,
            purchases: 0, purchaseReturn: 0, deliveryChallan: 0, wholesaleReturn: 0,
          };
          itemMetricsMap.set(itemId, m);
        }

        const qty = Number(entry.qty || 0);
        const ref = entry.referenceType || '';
        const mov = entry.movementType;

        if (mov === MovementType.ADJUSTMENT || ref === 'STOCK_ADJUSTMENT' || ref === 'ADJUSTMENT') {
          m.adj += qty;
        } else if (qty > 0) {
          if (['TRANSFER_REQUEST', 'TRANSFER_IN', 'OUTLET_TRANSFER_IN'].includes(ref)) {
            const tr = entry.referenceId ? trMap.get(entry.referenceId) : null;
            if (tr) {
              if (tr.fromWarehouseId === centralWhId) {
                m.fromWarehouse += qty;
              } else {
                m.fromOutlet += qty;
              }
            } else {
              if (ref === 'OUTLET_TRANSFER_IN') {
                m.fromOutlet += qty;
              } else if (isCentralWarehouseScope) {
                m.fromOutlet += qty;
              } else {
                m.fromWarehouse += qty;
              }
            }
          } else if (['POS_RETURN', 'POS_EXCHANGE_IN'].includes(ref)) {
            m.exchg += qty;
          } else if (['POS_REFUND', 'POS_VOID'].includes(ref)) {
            m.refund += qty;
          } else if (ref === 'POS_CLAIM_APPROVED') {
            m.claim += qty;
          } else if (['LANDED_COST', 'GRN', 'PURCHASE_INVOICE', 'PURCHASE_RECEIPT'].includes(ref)) {
            m.purchases += qty;
          } else if (['SALES_RETURN_DC', 'SALES_RETURN_INV', 'WHOLESALE_RETURN'].includes(ref)) {
            m.wholesaleReturn += qty;
          } else if (['RETURN_REQUEST', 'CLAIM_RETURN', 'OUTLET_RETURN', 'CLAIM_RETURN_RECEIPT'].includes(ref)) {
            m.fromOutlet += qty;
          } else {
            m.adj += qty;
          }
        } else if (qty < 0) {
          const absQty = Math.abs(qty);
          if (['TRANSFER_REQUEST', 'TRANSFER_OUT', 'OUTLET_TRANSFER_OUT'].includes(ref)) {
            const tr = entry.referenceId ? trMap.get(entry.referenceId) : null;
            if (tr) {
              if (tr.toWarehouseId === centralWhId) {
                m.toWarehouse += absQty;
              } else {
                m.toOutlet += absQty;
              }
            } else {
              if (ref === 'OUTLET_TRANSFER_OUT') {
                m.toOutlet += absQty;
              } else if (isCentralWarehouseScope) {
                m.toOutlet += absQty;
              } else {
                m.toOutlet += absQty;
              }
            }
          } else if (['RETURN_REQUEST', 'CLAIM_RETURN', 'CLAIM_TO_PLM', 'CLAIM_RETURN_REQUEST'].includes(ref)) {
            m.toWarehouse += absQty;
          } else if (['POS_SALE', 'POS_EXCHANGE_OUT'].includes(ref)) {
            m.sales += absQty;
          } else if (['PURCHASE_RETURN', 'PURCHASE_RETURN_LC', 'PURCHASE_RETURN_GRN', 'PURCHASE_RETURN_INV'].includes(ref)) {
            m.purchaseReturn += absQty;
          } else if (['DELIVERY_CHALLAN', 'SALES_DELIVERY'].includes(ref)) {
            m.deliveryChallan += absQty;
          } else {
            m.adj += qty;
          }
        }
      }

      // Build hierarchical grouping dynamically
      const sBrand = showBrand !== false;
      const sDivision = showDivision !== false;
      const sCategory = showCategory !== false;
      const sGender = showGender !== false;
      const sSilhouette = showSilhouette !== false;
      const sArticle = showArticle !== false;
      const sVariant = showVariant !== undefined ? showVariant : !summaryOnly;

      const levels: string[] = [];
      if (sBrand) levels.push('brand');
      if (sDivision) levels.push('division');
      if (sCategory) levels.push('category');
      if (sGender) levels.push('gender');
      if (sSilhouette) levels.push('silhouette');
      if (sArticle) levels.push('article');
      if (sVariant) levels.push('variant');

      if (levels.length === 0) {
        levels.push('brand');
      }

      const root: any[] = [];
      const createEmptyTotals = () => ({
        bf: 0, fromWarehouse: 0, fromOutlet: 0, totalTrfIn: 0,
        toWarehouse: 0, toOutlet: 0, totalTrfOut: 0, exchg: 0,
        refund: 0, claim: 0, sales: 0, adj: 0, availableStock: 0,
        transit: 0, balance: 0,
        purchases: 0, purchaseReturn: 0, deliveryChallan: 0, wholesaleReturn: 0,
        reservedSO: 0, reservedSRN: 0, transitGRN: 0,
      });

      const addTotals = (target: any, source: any) => {
        target.bf += source.bf || 0;
        target.fromWarehouse += source.fromWarehouse || 0;
        target.fromOutlet += source.fromOutlet || 0;
        target.totalTrfIn += source.totalTrfIn || 0;
        target.toWarehouse += source.toWarehouse || 0;
        target.toOutlet += source.toOutlet || 0;
        target.totalTrfOut += source.totalTrfOut || 0;
        target.exchg += source.exchg || 0;
        target.refund += source.refund || 0;
        target.claim += source.claim || 0;
        target.sales += source.sales || 0;
        target.adj += source.adj || 0;
        target.availableStock += source.availableStock || 0;
        target.transit += source.transit || 0;
        target.balance += source.balance || 0;
        target.purchases = (target.purchases || 0) + (source.purchases || 0);
        target.purchaseReturn = (target.purchaseReturn || 0) + (source.purchaseReturn || 0);
        target.deliveryChallan = (target.deliveryChallan || 0) + (source.deliveryChallan || 0);
        target.wholesaleReturn = (target.wholesaleReturn || 0) + (source.wholesaleReturn || 0);
        target.reservedSO = (target.reservedSO || 0) + (source.reservedSO || 0);
        target.reservedSRN = (target.reservedSRN || 0) + (source.reservedSRN || 0);
        target.transitGRN = (target.transitGRN || 0) + (source.transitGRN || 0);
      };

      for (const item of items) {
        const bf = bfMap.get(item.id) || 0;
        const transit = transitMap.get(item.id) || 0;
        const m = itemMetricsMap.get(item.id) || {
          fromWarehouse: 0, fromOutlet: 0, toWarehouse: 0, toOutlet: 0,
          exchg: 0, refund: 0, claim: 0, sales: 0, adj: 0,
        };

        const totalTrfIn = m.fromWarehouse + m.fromOutlet;
        const totalTrfOut = m.toWarehouse + m.toOutlet;
        const availableStock = bf + totalTrfIn - totalTrfOut + m.exchg + m.refund + m.claim - m.sales + m.adj;
        const balance = availableStock + transit;

        const variantMetrics = {
          bf,
          fromWarehouse: m.fromWarehouse,
          fromOutlet: m.fromOutlet,
          totalTrfIn,
          toWarehouse: m.toWarehouse,
          toOutlet: m.toOutlet,
          totalTrfOut,
          exchg: m.exchg,
          refund: m.refund,
          claim: m.claim,
          sales: m.sales,
          adj: m.adj,
          availableStock,
          transit,
          balance,
          purchases: (m as any).purchases || 0,
          purchaseReturn: (m as any).purchaseReturn || 0,
          deliveryChallan: (m as any).deliveryChallan || 0,
          wholesaleReturn: (m as any).wholesaleReturn || 0,
          reservedSO: (m as any).reservedSO || 0,
          reservedSRN: (m as any).reservedSRN || 0,
          transitGRN: (m as any).transitGRN || 0,
        };

        let currentLevelNodes = root;
        for (let i = 0; i < levels.length; i++) {
          const levelName = levels[i];
          let nodeVal = '';
          let extraFields: any = {};

          if (levelName === 'brand') {
            nodeVal = item.brand?.name || 'No Brand';
          } else if (levelName === 'division') {
            nodeVal = item.division?.name || 'No Division';
          } else if (levelName === 'category') {
            nodeVal = item.category?.name || 'No Category';
          } else if (levelName === 'gender') {
            nodeVal = item.gender?.name || 'No Gender';
          } else if (levelName === 'silhouette') {
            nodeVal = item.silhouette?.name || 'No Silhouette';
          } else if (levelName === 'article') {
            nodeVal = item.sku;
            extraFields.sku = item.sku;
            extraFields.articleName = item.description || 'Unknown Article';
          } else if (levelName === 'variant') {
            nodeVal = `${item.color?.name || 'Default'}-${item.size?.name || 'Default'}`;
            extraFields.color = item.color?.name || 'Default';
            extraFields.size = item.size?.name || 'Default';
          }

          let existingNode = currentLevelNodes.find(n => n.level === levelName && n.value === nodeVal);
          if (!existingNode) {
            existingNode = {
              level: levelName,
              value: nodeVal,
              totals: createEmptyTotals(),
              ...extraFields,
              children: [],
            };
            currentLevelNodes.push(existingNode);
          }

          addTotals(existingNode.totals, variantMetrics);

          if (i < levels.length - 1) {
            currentLevelNodes = existingNode.children;
          }
        }
      }

      // Compute grand totals
      const grandTotals = createEmptyTotals();
      for (const node of root) {
        addTotals(grandTotals, node.totals);
      }

      await job.progress(80);

      if (format === 'pdf') {
        const fromDateStr = startDate.toLocaleDateString();
        const toDateStr = endDate.toLocaleDateString();
        const html = this.buildPdfHtml(root, locationName, fromDateStr, toDateStr, grandTotals, !!summaryOnly);

        const launchArgs = process.platform === 'linux'
          ? [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
              '--no-first-run',
              '--no-zygote',
            ]
          : [];

        const browser = await puppeteer.launch({
          headless: true,
          args: launchArgs,
        });

        try {
          const page = await browser.newPage();
          page.setDefaultTimeout(0);
          page.setDefaultNavigationTimeout(0);
          await page.setContent(html, { waitUntil: 'domcontentloaded' });

          // Start an active progress ticker to prevent UI looking stuck at 80%
          let currentProgress = 80;
          const progressInterval = setInterval(() => {
            if (currentProgress < 94) {
              currentProgress += 1;
              job.progress(currentProgress).catch(() => {});
            }
          }, 3000);

          let pdfBuffer;
          try {
            pdfBuffer = await page.pdf({
              format: 'A4',
              landscape: true,
              margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' },
              printBackground: true,
              displayHeaderFooter: true,
              headerTemplate: '<div style="font-size: 7px; width: 100%; text-align: right; padding-right: 15mm; color: #94a3b8;">Speed (Pvt.) Limited | Stock Activity Report</div>',
              footerTemplate: '<div style="font-size: 7px; width: 100%; text-align: center; color: #94a3b8;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
            });
          } finally {
            clearInterval(progressInterval);
          }

          fs.writeFileSync(filePath, pdfBuffer);
        } finally {
          await browser.close();
        }
      } else {
        // XLSX Format Export
        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
          filename: filePath,
          useStyles: true,
          useSharedStrings: false,
        });

        const ws = workbook.addWorksheet('Stock Activity Report', {
          pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
          views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }],
        });

        const selectedColumns = reportType === 'detailed' ? DETAILED_COLUMNS : COLUMNS;
        ws.columns = selectedColumns.map(c => ({ key: c.key, width: c.width }));

        // 1. Group Header bands
        const groups: Record<string, { start: number; end: number }> = {};
        selectedColumns.forEach((col, idx) => {
          const n = idx + 1;
          if (!groups[col.group]) groups[col.group] = { start: n, end: n };
          else groups[col.group].end = n;
        });

        const groupRow = ws.getRow(1);
        selectedColumns.forEach((col, idx) => {
          const cell = groupRow.getCell(idx + 1);
          const { start } = groups[col.group];
          if (idx + 1 === start) cell.value = col.group.toUpperCase();
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${GROUP_COLORS[col.group] ?? '1E293B'}` } };
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          };
        });
        groupRow.height = 22;
        groupRow.commit();

        // 2. Main Columns headers
        const headerRow = ws.getRow(2);
        selectedColumns.forEach((col, idx) => {
          const cell = headerRow.getCell(idx + 1);
          cell.value = col.header;
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
          cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'medium', color: { argb: 'FF1E293B' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          };
        });
        headerRow.height = 22;
        headerRow.commit();

        const borderThin = {
          top: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
        };

        const rightAlign = { horizontal: 'right' as const, vertical: 'middle' as const };
        const leftAlign = { horizontal: 'left' as const, vertical: 'middle' as const };
        const centerAlign = { horizontal: 'center' as const, vertical: 'middle' as const };

        const styleHeaderRow = (row: ExcelJS.Row, bgHex: string, bold: boolean, size = 9, fgHex = '1E293B') => {
          for (let colNum = 1; colNum <= 18; colNum++) {
            const cell = row.getCell(colNum);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bgHex}` } };
            cell.font = { bold, size, color: { argb: `FF${fgHex}` } };
            cell.border = borderThin;
            cell.alignment = colNum <= 3 ? (colNum === 1 ? leftAlign : centerAlign) : rightAlign;
          }
          row.height = 20;
          row.commit();
        };

        // Write hierarchy data
        const LEVEL_EXCEL_STYLES: Record<string, {
          bgHex: string;
          fgHex: string;
          fontSize: number;
          bold: boolean;
          indent: number;
          prefix: string;
        }> = {
          brand: { bgHex: '1E293B', fgHex: 'FFFFFF', fontSize: 10, bold: true, indent: 0, prefix: 'BRAND: ' },
          division: { bgHex: '334155', fgHex: 'FFFFFF', fontSize: 9.5, bold: true, indent: 2, prefix: 'DIVISION: ' },
          category: { bgHex: '475569', fgHex: 'FFFFFF', fontSize: 9, bold: true, indent: 4, prefix: 'CATEGORY: ' },
          gender: { bgHex: '64748B', fgHex: 'FFFFFF', fontSize: 9, bold: true, indent: 6, prefix: 'GENDER: ' },
          silhouette: { bgHex: '94A3B8', fgHex: 'FFFFFF', fontSize: 9, bold: true, indent: 8, prefix: 'SILHOUETTE: ' },
          article: { bgHex: 'F1F5F9', fgHex: '1E293B', fontSize: 9, bold: true, indent: 10, prefix: 'SKU: ' },
          variant: { bgHex: 'FFFFFF', fgHex: '475569', fontSize: 9, bold: false, indent: 12, prefix: '' },
        };

        const writeNodeToExcel = (node: any) => {
          const style = LEVEL_EXCEL_STYLES[node.level] || LEVEL_EXCEL_STYLES.brand;
          
          let label = ' '.repeat(style.indent) + style.prefix;
          let colorVal = '';
          let sizeVal = '';
          
          if (node.level === 'article') {
            label = ' '.repeat(style.indent) + `SKU: ${node.sku} (${node.articleName})`;
            colorVal = 'ALL COLORS';
            sizeVal = 'ALL SIZES';
          } else if (node.level === 'variant') {
            label = ' '.repeat(style.indent) + 'Variant Item';
            colorVal = node.color;
            sizeVal = node.size;
          } else {
            label = ' '.repeat(style.indent) + style.prefix + node.value.toUpperCase();
          }
          
          const t = node.totals;
          const rowVals: any[] = [label, colorVal, sizeVal, t.bf];
          if (reportType !== 'detailed') {
            rowVals.push(
              t.fromWarehouse,
              t.fromOutlet,
              t.totalTrfIn,
              t.toWarehouse,
              t.toOutlet,
              t.totalTrfOut,
              t.exchg,
              t.refund,
              t.claim,
              t.sales,
              t.adj,
              t.availableStock,
              t.transit,
              t.balance
            );
          } else {
            rowVals.push(
              t.purchases || 0,
              t.purchaseReturn || 0,
              t.fromOutlet,
              t.toOutlet,
              t.deliveryChallan || 0,
              t.wholesaleReturn || 0,
              t.adj,
              t.availableStock,
              t.reservedSO || 0,
              t.reservedSRN || 0,
              (t.reservedSO || 0) + (t.reservedSRN || 0),
              (t.availableStock || 0) - ((t.reservedSO || 0) + (t.reservedSRN || 0)),
              t.transitGRN || 0,
              t.transit,
              t.balance
            );
          }
          
          const row = ws.addRow(rowVals);
          
          for (let colNum = 1; colNum <= selectedColumns.length; colNum++) {
            const cell = row.getCell(colNum);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${style.bgHex}` } };
            cell.font = { bold: style.bold, size: style.fontSize, color: { argb: `FF${style.fgHex}` } };
            cell.border = borderThin;
            cell.alignment = colNum === 2 || colNum === 3 
              ? centerAlign 
              : (colNum === 1 ? leftAlign : rightAlign);
          }
          row.height = node.level === 'variant' ? 18 : 20;
          row.commit();
          
          if (node.children && node.children.length > 0) {
            for (const child of node.children) {
              writeNodeToExcel(child);
            }
          }
        };

        for (const rootNode of root) {
          writeNodeToExcel(rootNode);
        }

        // Add GRAND TOTALS Row at bottom of Excel
        const gtRowVals: any[] = ['GRAND TOTAL', '', '', grandTotals.bf];
        if (reportType !== 'detailed') {
          gtRowVals.push(
            grandTotals.fromWarehouse,
            grandTotals.fromOutlet,
            grandTotals.totalTrfIn,
            grandTotals.toWarehouse,
            grandTotals.toOutlet,
            grandTotals.totalTrfOut,
            grandTotals.exchg,
            grandTotals.refund,
            grandTotals.claim,
            grandTotals.sales,
            grandTotals.adj,
            grandTotals.availableStock,
            grandTotals.transit,
            grandTotals.balance
          );
        } else {
          gtRowVals.push(
            grandTotals.purchases || 0,
            grandTotals.purchaseReturn || 0,
            grandTotals.fromOutlet,
            grandTotals.toOutlet,
            grandTotals.deliveryChallan || 0,
            grandTotals.wholesaleReturn || 0,
            grandTotals.adj,
            grandTotals.availableStock,
            grandTotals.reservedSO || 0,
            grandTotals.reservedSRN || 0,
            (grandTotals.reservedSO || 0) + (grandTotals.reservedSRN || 0),
            (grandTotals.availableStock || 0) - ((grandTotals.reservedSO || 0) + (grandTotals.reservedSRN || 0)),
            grandTotals.transitGRN || 0,
            grandTotals.transit,
            grandTotals.balance
          );
        }

        const totalRow = ws.addRow(gtRowVals);

        totalRow.eachCell((cell, colNum) => {
          cell.font = { bold: true, size: 10, color: { argb: 'FF000000' } };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'double', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
          cell.alignment = colNum <= 3 ? leftAlign : rightAlign;
        });
        totalRow.height = 24;
        totalRow.commit();

        await workbook.commit();
      }

      await job.progress(95);

      const mimeType = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const fileName = format === 'pdf'
        ? `stock-activity-report-${new Date().toISOString().slice(0, 10)}.pdf`
        : `stock-activity-report-${new Date().toISOString().slice(0, 10)}.xlsx`;

      await this.exportHistoryService.completeAndUploadExport(
        prisma,
        jobId,
        filePath,
        fileName,
        mimeType,
      );

      // Notify User via Socket notification
      await this.notificationsService.create({
        userId,
        title: 'Stock Activity Export Ready',
        message: `Your Stock Activity ${format.toUpperCase()} report has been processed successfully.`,
        category: 'export',
        priority: 'high',
        actionType: 'stock-activity-export.ready',
        actionPayload: JSON.stringify({ jobId }),
      });

      await job.progress(100);
      this.logger.log(`[StockActivityExport ${jobId}] Finished processing ${format.toUpperCase()} successfully`);
    } catch (err) {
      this.logger.error(`[StockActivityExport ${jobId}] Failed: ${err.message}`, err.stack);
      await this.exportHistoryService.failExport(prisma, jobId);
      throw err;
    }
  }

  private buildPdfHtml(
    data: any[],
    locationName: string,
    fromDateStr: string,
    toDateStr: string,
    grandTotals: any,
    summaryOnly: boolean,
  ): string {
    let rowsHtml = '';
    const formatVal = (val: number) => val === 0 ? '-' : val.toString();

    const LEVEL_PDF_STYLES: Record<string, {
      className: string;
      indentStyles: string;
      prefix: string;
    }> = {
      brand: { className: 'brand-row', indentStyles: '', prefix: 'BRAND: ' },
      division: { className: 'division-row', indentStyles: 'padding-left: 10px;', prefix: 'DIVISION: ' },
      category: { className: 'category-row', indentStyles: 'padding-left: 20px;', prefix: 'CATEGORY: ' },
      gender: { className: 'gender-row', indentStyles: 'padding-left: 30px;', prefix: 'GENDER: ' },
      silhouette: { className: 'silhouette-row', indentStyles: 'padding-left: 40px;', prefix: 'SILHOUETTE: ' },
      article: { className: 'article-row', indentStyles: 'padding-left: 50px;', prefix: 'SKU: ' },
      variant: { className: 'variant-row', indentStyles: 'padding-left: 60px;', prefix: '' },
    };

    const buildHtmlRows = (node: any): string => {
      const style = LEVEL_PDF_STYLES[node.level] || LEVEL_PDF_STYLES.brand;
      let html = '';
      
      if (node.level === 'article') {
        html += `
          <tr class="${style.className}">
            <td style="${style.indentStyles}">SKU: ${node.sku} (${node.articleName})</td>
            <td class="center">ALL COLORS</td>
            <td class="center">ALL SIZES</td>
            <td class="num">${formatVal(node.totals.bf)}</td>
            <td class="num">${formatVal(node.totals.fromWarehouse)}</td>
            <td class="num">${formatVal(node.totals.fromOutlet)}</td>
            <td class="num highlight-in">${formatVal(node.totals.totalTrfIn)}</td>
            <td class="num">${formatVal(node.totals.toWarehouse)}</td>
            <td class="num">${formatVal(node.totals.toOutlet)}</td>
            <td class="num highlight-out">${formatVal(node.totals.totalTrfOut)}</td>
            <td class="num">${formatVal(node.totals.exchg)}</td>
            <td class="num">${formatVal(node.totals.refund)}</td>
            <td class="num">${formatVal(node.totals.claim)}</td>
            <td class="num">${formatVal(node.totals.sales)}</td>
            <td class="num">${formatVal(node.totals.adj)}</td>
            <td class="num highlight-avail">${formatVal(node.totals.availableStock)}</td>
            <td class="num highlight-transit">${formatVal(node.totals.transit)}</td>
            <td class="num highlight-bal">${formatVal(node.totals.balance)}</td>
          </tr>
        `;
      } else if (node.level === 'variant') {
        html += `
          <tr class="${style.className}">
            <td style="${style.indentStyles} color: #64748b; font-style: italic;">&mdash; Variant Item</td>
            <td class="center">${node.color}</td>
            <td class="center">${node.size}</td>
            <td class="num">${formatVal(node.totals.bf)}</td>
            <td class="num">${formatVal(node.totals.fromWarehouse)}</td>
            <td class="num">${formatVal(node.totals.fromOutlet)}</td>
            <td class="num highlight-in">${formatVal(node.totals.totalTrfIn)}</td>
            <td class="num">${formatVal(node.totals.toWarehouse)}</td>
            <td class="num">${formatVal(node.totals.toOutlet)}</td>
            <td class="num highlight-out">${formatVal(node.totals.totalTrfOut)}</td>
            <td class="num">${formatVal(node.totals.exchg)}</td>
            <td class="num">${formatVal(node.totals.refund)}</td>
            <td class="num">${formatVal(node.totals.claim)}</td>
            <td class="num">${formatVal(node.totals.sales)}</td>
            <td class="num">${formatVal(node.totals.adj)}</td>
            <td class="num highlight-avail">${formatVal(node.totals.availableStock)}</td>
            <td class="num highlight-transit">${formatVal(node.totals.transit)}</td>
            <td class="num highlight-bal">${formatVal(node.totals.balance)}</td>
          </tr>
        `;
      } else {
        html += `
          <tr class="${style.className}">
            <td colspan="3" style="${style.indentStyles}">${style.prefix}${node.value.toUpperCase()}</td>
            <td class="num">${formatVal(node.totals.bf)}</td>
            <td class="num">${formatVal(node.totals.fromWarehouse)}</td>
            <td class="num">${formatVal(node.totals.fromOutlet)}</td>
            <td class="num highlight-in">${formatVal(node.totals.totalTrfIn)}</td>
            <td class="num">${formatVal(node.totals.toWarehouse)}</td>
            <td class="num">${formatVal(node.totals.toOutlet)}</td>
            <td class="num highlight-out">${formatVal(node.totals.totalTrfOut)}</td>
            <td class="num">${formatVal(node.totals.exchg)}</td>
            <td class="num">${formatVal(node.totals.refund)}</td>
            <td class="num">${formatVal(node.totals.claim)}</td>
            <td class="num">${formatVal(node.totals.sales)}</td>
            <td class="num">${formatVal(node.totals.adj)}</td>
            <td class="num highlight-avail">${formatVal(node.totals.availableStock)}</td>
            <td class="num highlight-transit">${formatVal(node.totals.transit)}</td>
            <td class="num highlight-bal">${formatVal(node.totals.balance)}</td>
          </tr>
        `;
      }
      
      if (node.children && node.children.length > 0) {
        for (const child of node.children) {
          html += buildHtmlRows(child);
        }
      }
      
      return html;
    };

    for (const rootNode of data) {
      rowsHtml += buildHtmlRows(rootNode);
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #1e293b;
            font-size: 7px;
            margin: 0;
            padding: 0;
            background: #ffffff;
          }
          .page-break {
            page-break-after: always;
            break-after: page;
          }

          /* Table view details */
          .header-block {
            border-bottom: 2px solid #0f172a;
            padding-bottom: 8px;
            margin-bottom: 12px;
          }
          .company-name {
            font-size: 14px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #0f172a;
          }
          .report-title {
            font-size: 11px;
            font-weight: 700;
            color: #475569;
            margin-top: 2px;
          }
          .meta-info {
            font-size: 8px;
            color: #64748b;
            margin-top: 4px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            page-break-inside: auto;
          }
          tr {
            page-break-inside: auto;
          }
          tr.brand-row, tr.division-row, tr.category-row, tr.gender-row, tr.silhouette-row, tr.article-row, tr.grand-total-row {
            page-break-inside: avoid;
          }
          thead {
            display: table-header-group;
          }
          th {
            background-color: #334155;
            color: #ffffff;
            font-weight: 700;
            text-transform: uppercase;
            font-size: 6px;
            padding: 4px 3px;
            border: 1px solid #475569;
            text-align: center;
          }
          th.align-left {
            text-align: left;
          }
          td {
            padding: 3px 2px;
            border: 1px solid #e2e8f0;
            vertical-align: middle;
          }
          td.num {
            text-align: right;
          }
          td.center {
            text-align: center;
          }
          td.indent {
            color: #64748b;
            font-style: italic;
            padding-left: 10px;
          }
          
          /* Rows Styling */
          .brand-row {
            background-color: #1e293b;
            font-weight: 800;
            font-size: 8px;
            color: #ffffff;
          }
          .division-row {
            background-color: #334155;
            font-weight: 700;
            font-size: 7.5px;
            color: #ffffff;
          }
          .category-row {
            background-color: #475569;
            font-weight: 700;
            font-size: 7px;
            color: #ffffff;
          }
          .gender-row {
            background-color: #64748b;
            font-weight: 700;
            font-size: 7px;
            color: #ffffff;
          }
          .silhouette-row {
            background-color: #94a3b8;
            font-weight: 700;
            font-size: 7px;
            color: #ffffff;
          }
          .article-row {
            background-color: #f1f5f9;
            font-weight: 700;
            font-size: 7px;
            color: #0f172a;
          }
          .variant-row {
            background-color: #ffffff;
            color: #475569;
          }
          .grand-total-row {
            background-color: #cbd5e1;
            font-weight: 900;
            font-size: 8px;
            color: #000000;
          }
          
          /* Column highlighting */
          .highlight-in {
            background-color: rgba(16, 185, 129, 0.08);
            font-weight: 700;
            color: #047857;
          }
          .highlight-out {
            background-color: rgba(239, 68, 68, 0.08);
            font-weight: 700;
            color: #b91c1c;
          }
          .highlight-avail {
            background-color: rgba(59, 130, 246, 0.08);
            font-weight: 700;
            color: #1d4ed8;
          }
          .highlight-transit {
            font-weight: 700;
            color: #b45309;
          }
          .highlight-bal {
            background-color: #f1f5f9;
            font-weight: 900;
            color: #0f172a;
          }
        </style>
      </head>
      <body>

        <!-- Page 2+: Detailed Hierarchy Table -->
        <div class="header-block">
          <div class="company-name">Speed (Pvt.) Limited</div>
          <div class="report-title">Stock Activity Report — ${locationName}</div>
          <div class="meta-info">Period: ${fromDateStr} to ${toDateStr}</div>
        </div>
        <table style="table-layout: fixed; width: 100%;">
          <colgroup>
            <col style="width: 15%;" />
            <col style="width: 6%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
          </colgroup>
          <thead>
            <tr>
              <th colspan="3" class="align-left">Article / Variant Info</th>
              <th>Opening</th>
              <th>Wh IN</th>
              <th>Outlet IN</th>
              <th style="background-color: #047857;">Trf IN</th>
              <th>Wh OUT</th>
              <th>Outlet OUT</th>
              <th style="background-color: #b91c1c;">Trf OUT</th>
              <th>Exchg</th>
              <th>Refund</th>
              <th>Claim</th>
              <th>Sales</th>
              <th>Adj</th>
              <th style="background-color: #1d4ed8;">Available</th>
              <th style="background-color: #b45309;">Transit</th>
              <th style="background-color: #0f172a;">Balance</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            
            <!-- GRAND TOTALS ROW AT BOTTOM -->
            <tr class="grand-total-row">
              <td colspan="3">GRAND TOTAL</td>
              <td class="num">${formatVal(grandTotals.bf)}</td>
              <td class="num">${formatVal(grandTotals.fromWarehouse)}</td>
              <td class="num">${formatVal(grandTotals.fromOutlet)}</td>
              <td class="num highlight-in">${formatVal(grandTotals.totalTrfIn)}</td>
              <td class="num">${formatVal(grandTotals.toWarehouse)}</td>
              <td class="num">${formatVal(grandTotals.toOutlet)}</td>
              <td class="num highlight-out">${formatVal(grandTotals.totalTrfOut)}</td>
              <td class="num">${formatVal(grandTotals.exchg)}</td>
              <td class="num">${formatVal(grandTotals.refund)}</td>
              <td class="num">${formatVal(grandTotals.claim)}</td>
              <td class="num">${formatVal(grandTotals.sales)}</td>
              <td class="num">${formatVal(grandTotals.adj)}</td>
              <td class="num highlight-avail">${formatVal(grandTotals.availableStock)}</td>
              <td class="num highlight-transit">${formatVal(grandTotals.transit)}</td>
              <td class="num highlight-bal">${formatVal(grandTotals.balance)}</td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;
  }

  private async writeEmptyWorkbook(filePath: string, selectedColumns = COLUMNS): Promise<void> {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: filePath,
      useStyles: true,
      useSharedStrings: false,
    });
    const ws = workbook.addWorksheet('Stock Activity Report');
    ws.columns = selectedColumns.map(c => ({ key: c.key, width: c.width }));
    const r = ws.addRow({ A: 'No data matches filters' });
    r.commit();
    await workbook.commit();
  }

  private async writeEmptyPdf(filePath: string, locationName: string, startDate: Date, endDate: Date): Promise<void> {
    const html = `
      <html>
      <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h2>Speed (Pvt.) Limited - Stock Activity Report</h2>
        <p>Outlet: ${locationName}</p>
        <p>Period: ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}</p>
        <div style="margin-top: 30px; color: #666;">No ledger records found matching options.</div>
      </body>
      </html>
    `;
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html);
    const pdf = await page.pdf({ format: 'A4', landscape: true });
    fs.writeFileSync(filePath, pdf);
    await browser.close();
  }
}
