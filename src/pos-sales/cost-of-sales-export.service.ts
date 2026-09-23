import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../database/prisma.service';
import { UploadService } from '../upload/upload.service';
import { ExportHistoryService } from '../warehouse/export-history/export-history.service';
import { PrismaClient } from '@prisma/client';
import { chunkArray } from '../common/utils/chunk.util';

export interface QueueCostOfSalesExportOptions {
  userId: string;
  locationId?: string;
  startDate?: string;
  endDate?: string;
  format: 'xlsx' | 'pdf';
  exportType?: 'hierarchical' | 'flat';
  search?: string;
  filterBrands?: string[];
  filterDivisions?: string[];
  filterCategories?: string[];
  filterGenders?: string[];
  filterSilhouettes?: string[];
  previewJobId?: string;
}

export interface CostOfSalesSizeItem {
  id: string;
  size: string;
  color: string;
  barCode?: string;
  quantity: number;
  costPrice: number;
  totalCost: number;
  unitPrice: number;
  totalRevenue: number;
  grossProfit: number;
  profitMargin: number;
}

export interface CostOfSalesProductNode {
  sku: string;
  description: string;
  productLabel: string;
  sizes: CostOfSalesSizeItem[];
  totals: {
    quantity: number;
    totalCost: number;
    avgUnitCost: number;
    totalRevenue: number;
    grossProfit: number;
    profitMargin: number;
  };
}

export interface CostOfSalesCategoryNode {
  categoryId: string;
  categoryName: string;
  products: CostOfSalesProductNode[];
  totals: {
    quantity: number;
    totalCost: number;
    avgUnitCost: number;
    totalRevenue: number;
    grossProfit: number;
    profitMargin: number;
  };
}

export interface CostOfSalesGenderNode {
  genderId: string;
  genderName: string;
  categories: CostOfSalesCategoryNode[];
  totals: {
    quantity: number;
    totalCost: number;
    avgUnitCost: number;
    totalRevenue: number;
    grossProfit: number;
    profitMargin: number;
  };
}

export interface CostOfSalesDivisionNode {
  divisionId: string;
  divisionName: string;
  genders: CostOfSalesGenderNode[];
  totals: {
    quantity: number;
    totalCost: number;
    avgUnitCost: number;
    totalRevenue: number;
    grossProfit: number;
    profitMargin: number;
  };
}

export interface CostOfSalesBrandNode {
  brandId: string;
  brandName: string;
  divisions: CostOfSalesDivisionNode[];
  totals: {
    quantity: number;
    totalCost: number;
    avgUnitCost: number;
    totalRevenue: number;
    grossProfit: number;
    profitMargin: number;
  };
}

export interface CostOfSalesFlatRecord {
  id: string;
  brand: string;
  division: string;
  category: string;
  gender: string;
  silhouette: string;
  sku: string;
  articleName: string;
  color: string;
  size: string;
  barCode: string;
  locationName: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  unitPrice: number;
  totalRevenue: number;
  grossProfit: number;
  profitMargin: number;
}

export interface CostOfSalesReportResult {
  brands: CostOfSalesBrandNode[];
  flatItems: CostOfSalesFlatRecord[];
  grandTotals: {
    quantity: number;
    totalCost: number;
    avgUnitCost: number;
    totalRevenue: number;
    grossProfit: number;
    profitMargin: number;
  };
  startDate: string;
  endDate: string;
  meta: {
    totalItems: number;
    locationsCount: number;
  };
}

@Injectable()
export class CostOfSalesExportService {
  private readonly logger = new Logger(CostOfSalesExportService.name);
  private readonly cancelledPreviewJobIds = new Set<string>();

  constructor(
    @InjectQueue('cost-of-sales-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
    private readonly exportHistoryService: ExportHistoryService,
  ) {}

  isJobCancelled(jobId?: string): boolean {
    if (!jobId) return false;
    return this.cancelledPreviewJobIds.has(jobId);
  }

  async queueReportPreview(opts: {
    userId: string;
    locationId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
    filterBrands?: string[];
    filterDivisions?: string[];
    filterCategories?: string[];
    filterGenders?: string[];
    filterSilhouettes?: string[];
  }): Promise<{ jobId: string; queuePosition: number; waitingCount: number }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    // Prune superseded waiting or active preview jobs for this user
    if (opts.userId) {
      try {
        const [waitingJobs, activeJobs] = await Promise.all([
          this.exportQueue.getWaiting(),
          this.exportQueue.getActive(),
        ]);

        for (const wJob of waitingJobs) {
          if (
            wJob.name === 'generate-cost-of-sales-preview' &&
            wJob.data?.userId === opts.userId
          ) {
            this.logger.log(`Pruning superseded waiting cost-of-sales preview job ${wJob.id}`);
            if (wJob.data?.jobId) this.cancelledPreviewJobIds.add(wJob.data.jobId);
            await wJob.remove();
          }
        }

        for (const aJob of activeJobs) {
          if (
            aJob.name === 'generate-cost-of-sales-preview' &&
            aJob.data?.userId === opts.userId
          ) {
            const activeJobId = aJob.data?.jobId;
            this.logger.log(`Cancelling active cost-of-sales preview job ${activeJobId}`);
            if (activeJobId) this.cancelledPreviewJobIds.add(activeJobId);
          }
        }
      } catch (err: any) {
        this.logger.warn(`Could not prune cost-of-sales preview jobs: ${err.message}`);
      }
    }

    await this.exportQueue.add(
      'generate-cost-of-sales-preview',
      {
        jobId,
        userId: opts.userId,
        tenantId,
        tenantDbUrl,
        locationId: opts.locationId,
        startDate: opts.startDate,
        endDate: opts.endDate,
        search: opts.search,
        filterBrands: opts.filterBrands,
        filterDivisions: opts.filterDivisions,
        filterCategories: opts.filterCategories,
        filterGenders: opts.filterGenders,
        filterSilhouettes: opts.filterSilhouettes,
      },
      {
        jobId,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    const [waiting, active] = await Promise.all([
      this.exportQueue.getWaiting(),
      this.exportQueue.getActive(),
    ]);

    const allJobs = [...active, ...waiting];
    const idx = allJobs.findIndex((j) => j.id?.toString() === jobId);
    const queuePosition = idx >= 0 ? idx + 1 : 1;

    return { jobId, queuePosition, waitingCount: waiting.length };
  }

  async getJobQueueStatus(jobId: string): Promise<{
    status: string;
    state: string;
    progress: number;
    message: string;
    queuePosition: number;
    waitingCount: number;
    failedReason?: string;
  }> {
    const job = await this.exportQueue.getJob(jobId);
    if (!job) {
      return { status: 'unknown', state: 'unknown', progress: 0, message: '', queuePosition: 0, waitingCount: 0 };
    }

    const state = await job.getState();
    const progressRaw = job.progress();
    let progress = 0;
    let message = '';

    if (typeof progressRaw === 'number') {
      progress = progressRaw;
    } else if (typeof progressRaw === 'object' && progressRaw !== null) {
      progress = (progressRaw as any).percent || 0;
      message = (progressRaw as any).message || '';
    }

    let queuePosition = 0;
    let waitingCount = 0;

    if (state === 'waiting' || state === 'delayed') {
      const [waiting, active] = await Promise.all([
        this.exportQueue.getWaiting(),
        this.exportQueue.getActive(),
      ]);
      waitingCount = waiting.length;
      const allJobs = [...active, ...waiting];
      const idx = allJobs.findIndex((j) => j.id?.toString() === jobId);
      queuePosition = idx >= 0 ? idx + 1 : 1;
    }

    return {
      status: state,
      state,
      progress,
      message,
      queuePosition,
      waitingCount,
      failedReason: job.failedReason,
    };
  }

  saveReportPreviewResult(jobId: string, data: any): void {
    const previewDir = path.join(process.cwd(), 'uploads', 'previews');
    fs.mkdirSync(previewDir, { recursive: true });

    const jsonStr = JSON.stringify(data);
    const gzipped = zlib.gzipSync(jsonStr);
    const filePath = path.join(previewDir, `cost-of-sales-preview-${jobId}.json.gz`);
    fs.writeFileSync(filePath, gzipped);

    setTimeout(() => {
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      }
    }, 60 * 60 * 1000);
  }

  getReportPreviewResult(jobId: string): any {
    const filePath = path.join(process.cwd(), 'uploads', 'previews', `cost-of-sales-preview-${jobId}.json.gz`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const gzipped = fs.readFileSync(filePath);
    const jsonStr = zlib.gunzipSync(gzipped).toString('utf-8');
    return JSON.parse(jsonStr);
  }

  async getReportData(params: {
    locationId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  }): Promise<CostOfSalesReportResult> {
    return this.generateCostOfSalesReportDataInternal(this.prisma, params);
  }

  // Core internal calculation engine
  async generateCostOfSalesReportDataInternal(
    prisma: PrismaClient | PrismaService,
    opts: {
      locationId?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
      filterBrands?: string[];
      filterDivisions?: string[];
      filterCategories?: string[];
      filterGenders?: string[];
      filterSilhouettes?: string[];
      onProgress?: (percent: number, message: string) => Promise<void> | void;
    },
  ): Promise<CostOfSalesReportResult> {
    const {
      locationId,
      startDate: startStr,
      endDate: endStr,
      search,
      onProgress,
    } = opts;

    const now = new Date();

    const parseLocalDate = (dateStr: string | undefined, isEndOfDay = false): Date => {
      if (!dateStr) {
        if (isEndOfDay) {
          const d = new Date(now);
          d.setHours(23, 59, 59, 999);
          return d;
        } else {
          return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        }
      }
      
      if (dateStr.includes('T') || dateStr.includes('Z')) {
        const d = new Date(dateStr);
        if (isEndOfDay && !dateStr.includes('T23:59:59')) {
          d.setHours(23, 59, 59, 999);
        }
        return d;
      }
      
      const timePart = isEndOfDay ? 'T23:59:59.999' : 'T00:00:00.000';
      return new Date(`${dateStr}${timePart}`);
    };

    const startDate = parseLocalDate(startStr, false);
    const endDate = parseLocalDate(endStr, true);

    const whereSalesLedger: any = {
      referenceType: { in: ['POS_SALE', 'POS_EXCHANGE_OUT', 'SALE'] },
      createdAt: { gte: startDate, lte: endDate },
    };

    if (locationId && locationId.trim() !== '' && locationId !== 'all') {
      const locationIds = locationId
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (locationIds.length > 0) {
        whereSalesLedger.locationId = { in: locationIds };
      }
    }

    const whereReturns: any = {
      referenceType: { in: ['POS_RETURN', 'POS_REFUND', 'POS_EXCHANGE_IN', 'POS_VOID'] },
      createdAt: { gte: startDate, lte: endDate },
    };

    if (locationId && locationId.trim() !== '' && locationId !== 'all') {
      const locationIds = locationId
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (locationIds.length > 0) {
        whereReturns.locationId = { in: locationIds };
      }
    }

    const whereDeliveryChallans: any = {
      referenceType: 'DELIVERY_CHALLAN',
      createdAt: { gte: startDate, lte: endDate },
    };

    if (locationId && locationId.trim() !== '' && locationId !== 'all') {
      const locationIds = locationId
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (locationIds.length > 0) {
        whereDeliveryChallans.locationId = { in: locationIds };
      }
    }

    if (search && search.trim() !== '') {
      const q = search.trim();
      const searchFilter = {
        OR: [
          { sku: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { barCode: { contains: q, mode: 'insensitive' } },
          { brand: { name: { contains: q, mode: 'insensitive' } } },
          { division: { name: { contains: q, mode: 'insensitive' } } },
          { category: { name: { contains: q, mode: 'insensitive' } } },
        ],
      };
      whereSalesLedger.item = searchFilter;
      whereReturns.item = searchFilter;
      whereDeliveryChallans.item = searchFilter;
    }

    await onProgress?.(30, 'Fetching stock sales, wholesale dispatches, returns & valuation costs...');

    const [posSalesLedgerEntries, returnLedgerEntries, dcLedgerEntries, valuationLedgers, locations] = await Promise.all([
      (prisma as any).stockLedger.findMany({
        where: whereSalesLedger,
        select: {
          id: true,
          itemId: true,
          qty: true,
          rate: true,
          unitCost: true,
          referenceId: true,
          locationId: true,
          createdAt: true,
          item: {
            select: {
              id: true,
              sku: true,
              barCode: true,
              description: true,
              unitCost: true,
              unitPrice: true,
              division: { select: { id: true, name: true } },
              brand: { select: { id: true, name: true } },
              gender: { select: { id: true, name: true } },
              category: { select: { id: true, name: true } },
              silhouette: { select: { id: true, name: true } },
              size: { select: { name: true } },
              color: { select: { name: true } },
            },
          },
        },
      }),
      (prisma as any).stockLedger.findMany({
        where: whereReturns,
        select: {
          id: true,
          qty: true,
          rate: true,
          unitCost: true,
          referenceId: true,
          locationId: true,
          item: {
            select: {
              id: true,
              sku: true,
              barCode: true,
              description: true,
              unitCost: true,
              unitPrice: true,
              division: { select: { id: true, name: true } },
              brand: { select: { id: true, name: true } },
              gender: { select: { id: true, name: true } },
              category: { select: { id: true, name: true } },
              silhouette: { select: { id: true, name: true } },
              size: { select: { name: true } },
              color: { select: { name: true } },
            },
          },
        },
      }),
      (prisma as any).stockLedger.findMany({
        where: whereDeliveryChallans,
        select: {
          id: true,
          qty: true,
          rate: true,
          unitCost: true,
          referenceId: true,
          locationId: true,
          createdAt: true,
          item: {
            select: {
              id: true,
              sku: true,
              barCode: true,
              description: true,
              unitCost: true,
              unitPrice: true,
              division: { select: { id: true, name: true } },
              brand: { select: { id: true, name: true } },
              gender: { select: { id: true, name: true } },
              category: { select: { id: true, name: true } },
              silhouette: { select: { id: true, name: true } },
              size: { select: { name: true } },
              color: { select: { name: true } },
            },
          },
        },
      }),
      (prisma as any).stockLedger.findMany({
        where: {
          ...(locationId && locationId.trim() !== '' && locationId !== 'all'
            ? { locationId: { in: locationId.split(',').map((s: string) => s.trim()).filter(Boolean) } }
            : {}),
          createdAt: { gte: startDate, lte: endDate },
        },
        select: {
          itemId: true,
          qty: true,
          unitCost: true,
          rate: true,
          movementType: true,
          referenceType: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.location.findMany({ select: { id: true, name: true } }),
    ]);

    // ── Build Live Weighted Average Cost / Closing Valuation Cost Map per Item ──
    const itemValuationMap = new Map<string, any[]>();
    for (const entry of valuationLedgers) {
      let list = itemValuationMap.get(entry.itemId);
      if (!list) {
        list = [];
        itemValuationMap.set(entry.itemId, list);
      }
      list.push(entry);
    }

    const itemCostMap = new Map<string, number>();

    for (const [itemId, entries] of itemValuationMap.entries()) {
      let qtyBalance = 0;
      let runningWac = 0;
      let periodOpeningQty = 0;
      let periodOpeningVal = 0;
      let purchaseQty = 0;
      let purchaseVal = 0;
      let purchaseRetQty = 0;
      let purchaseRetVal = 0;

      for (const entry of entries) {
        const entryQty = Number(entry.qty);
        let entryCost = Number(entry.unitCost ?? entry.rate ?? 0);
        const ref = entry.referenceType || '';

        const isInboundPurchase =
          entry.movementType === 'INBOUND' &&
          (ref === 'LANDED_COST' || ref === 'GRN' || ref === 'PURCHASE' || ref.startsWith('GRN') || ref.startsWith('PURCHASE'));

        if (entryCost === 0 && !isInboundPurchase) {
          entryCost = runningWac;
        }

        const isOpening =
          entry.movementType === 'OPENING_BALANCE' ||
          ref === 'OPENING_BALANCE' ||
          ref === 'BULK_STOCK_UPLOAD' ||
          ref === 'FISCAL_YEAR_OPENING';

        const isAdjustment =
          entry.movementType === 'ADJUSTMENT' ||
          ref === 'ADJUSTMENT' ||
          ref === 'STOCK_ADJUSTMENT' ||
          ref === 'SADJ' ||
          ref === 'CLOSING_BALANCE' ||
          ref === 'MANUAL_ZERO_STOCK';

        const isTransfer =
          entry.movementType === 'TRANSFER' ||
          ref.includes('TRANSFER') ||
          ref === 'STN';

        const isPosSalesReturn =
          !isTransfer &&
          (['POS_RETURN', 'POS_EXCHANGE_IN', 'POS_REFUND', 'POS_VOID', 'SALES_RETURN'].includes(ref) ||
            ref.startsWith('POS_RETURN') ||
            ref.startsWith('SALES_RETURN'));

        const isPurchaseReturn =
          ['PURCHASE_RETURN', 'PURCHASE_RETURN_GRN', 'PURCHASE_RETURN_LC', 'PURCHASE_RETURN_INV', 'PRN'].includes(ref);

        if (isOpening) {
          periodOpeningQty += entryQty;
          periodOpeningVal += entryQty * entryCost;
          qtyBalance += entryQty;
          if (qtyBalance > 0) runningWac = periodOpeningVal / periodOpeningQty;
        } else if (isInboundPurchase || (entry.movementType === 'INBOUND' && !isTransfer && !isPosSalesReturn)) {
          purchaseQty += entryQty;
          purchaseVal += entryQty * entryCost;
          const newQty = qtyBalance + entryQty;
          if (newQty > 0) runningWac = ((qtyBalance * runningWac) + (entryQty * entryCost)) / newQty;
          qtyBalance += entryQty;
        } else if (isPurchaseReturn) {
          const absQty = Math.abs(entryQty);
          purchaseRetQty += absQty;
          purchaseRetVal += absQty * entryCost;
          qtyBalance += entryQty;
        } else {
          qtyBalance += entryQty;
        }
      }

      const finalOpeningQty = periodOpeningQty;
      const finalOpeningVal = periodOpeningVal;
      const finalOpeningWac = finalOpeningQty > 0 ? finalOpeningVal / finalOpeningQty : 0;

      const availableQty = finalOpeningQty + purchaseQty - purchaseRetQty;
      const availableVal = finalOpeningVal + purchaseVal - purchaseRetVal;
      const availableCost = availableQty > 0 ? availableVal / availableQty : finalOpeningWac;

      if (availableCost > 0) {
        itemCostMap.set(itemId, availableCost);
      }
    }

    const returnRefIds = [...new Set(returnLedgerEntries.map((e: any) => e.referenceId).filter(Boolean))] as string[];
    const [returnVouchers, returnPosReturns] = await Promise.all([
      returnRefIds.length
        ? await (prisma as any).voucher.findMany({
            where: { id: { in: returnRefIds } },
          })
        : [],
      returnRefIds.length
        ? await (prisma as any).posReturn.findMany({
            where: { id: { in: returnRefIds } },
            include: {
              salesOrder: { include: { items: true } },
              items: true,
            },
          })
        : [],
    ]);

    const sourceOrderIds = [...new Set(returnVouchers.map((v: any) => v.sourceOrderId).filter(Boolean))] as string[];
    const sourceOrders = sourceOrderIds.length
      ? await prisma.salesOrder.findMany({
          where: { id: { in: sourceOrderIds } },
          include: { items: true },
        })
      : [];
    const sourceOrderMap = new Map<string, any>();
    for (const so of sourceOrders) {
      sourceOrderMap.set(so.id, so);
    }
    const voucherMap = new Map<string, any>();
    for (const v of returnVouchers) {
      voucherMap.set(v.id, {
        ...v,
        sourceOrder: v.sourceOrderId ? sourceOrderMap.get(v.sourceOrderId) : null,
      });
    }
    for (const pr of returnPosReturns) {
      voucherMap.set(pr.id, {
        id: pr.id,
        code: pr.returnNumber,
        sourceOrder: pr.salesOrder,
        posReturn: pr,
      });
    }

    const locationMap = new Map<string, string>(locations.map((l) => [l.id, l.name]));

    await onProgress?.(65, 'Building Net Cost of Sales tree & calculating gross profit metrics...');

    const brandsList: CostOfSalesBrandNode[] = [];
    const flatItemsList: CostOfSalesFlatRecord[] = [];
    const locationsSet = new Set<string>();

    const calculateTotals = (tot: {
      quantity: number;
      totalCost: number;
      avgUnitCost: number;
      totalRevenue: number;
      grossProfit: number;
      profitMargin: number;
    }) => {
      tot.avgUnitCost = tot.quantity !== 0 ? Math.round((tot.totalCost / Math.abs(tot.quantity)) * 100) / 100 : 0;
      tot.grossProfit = Math.round((tot.totalRevenue - tot.totalCost) * 100) / 100;
      tot.profitMargin = tot.totalRevenue !== 0 ? Math.round((tot.grossProfit / tot.totalRevenue) * 10000) / 100 : 0;
    };

    // 1. Process POS Sales Movements from StockLedger (Gross POS Sales)
    for (const sle of posSalesLedgerEntries) {
      if (!sle.item) continue;
      const locName = (sle.locationId && locationMap.get(sle.locationId)) || 'Main Location';
      locationsSet.add(sle.locationId || 'default');

      const qty = Math.abs(Number(sle.qty || 1));
      const unitCost = itemCostMap.get(sle.item.id) ?? Number(sle.item.unitCost || 0);
      const totalCost = Math.round(qty * unitCost * 100) / 100;

      const rawRate = Number(sle.rate || 0);
      const unitPrice = rawRate > 0 ? rawRate : Number(sle.item.unitPrice || 0);
      const taxPercent = 18;
      const taxDivisor = 1 + taxPercent / 100;
      const wostPerUnit = rawRate > 0 ? rawRate : (unitPrice / taxDivisor);
      const totalRevenue = Math.round(wostPerUnit * qty * 100) / 100;

      const grossProfit = Math.round((totalRevenue - totalCost) * 100) / 100;
      const profitMargin = totalRevenue !== 0 ? Math.round((grossProfit / totalRevenue) * 10000) / 100 : 0;

      const brandName = sle.item.brand?.name || 'Unassigned Brand';
      const brandId = sle.item.brand?.id || 'brand-unassigned';

      const divName = sle.item.division?.name || 'Unassigned Division';
      const divId = sle.item.division?.id || 'div-unassigned';

      const genderName = sle.item.gender?.name || 'Unassigned Gender';
      const genderId = sle.item.gender?.id || 'gender-unassigned';

      const catName = sle.item.category?.name || 'Unassigned Category';
      const catId = sle.item.category?.id || 'cat-unassigned';

      const silName = sle.item.silhouette?.name || 'Unassigned Silhouette';

      const sku = sle.item.sku || 'UNKNOWN-SKU';
      const desc = sle.item.description || 'No Description';
      const sizeName = sle.item.size?.name || 'N/A';
      const colorName = sle.item.color?.name || 'N/A';
      const barCode = sle.item.barCode || '';

      // Add to flat items dataset
      flatItemsList.push({
        id: `pos-${sle.id}`,
        brand: brandName,
        division: divName,
        category: catName,
        gender: genderName,
        silhouette: silName,
        sku,
        articleName: desc,
        color: colorName,
        size: sizeName,
        barCode,
        locationName: locName,
        quantity: qty,
        unitCost,
        totalCost,
        unitPrice,
        totalRevenue,
        grossProfit,
        profitMargin,
      });

      // 1. Brand Level
      let brandNode = brandsList.find((b) => b.brandId === brandId);
      if (!brandNode) {
        brandNode = {
          brandId,
          brandName,
          divisions: [],
          totals: { quantity: 0, totalCost: 0, avgUnitCost: 0, totalRevenue: 0, grossProfit: 0, profitMargin: 0 },
        };
        brandsList.push(brandNode);
      }

      // 2. Division Level
      let divNode = brandNode.divisions.find((d) => d.divisionId === divId);
      if (!divNode) {
        divNode = {
          divisionId: divId,
          divisionName: divName,
          genders: [],
          totals: { quantity: 0, totalCost: 0, avgUnitCost: 0, totalRevenue: 0, grossProfit: 0, profitMargin: 0 },
        };
        brandNode.divisions.push(divNode);
      }

      // 3. Gender Level
      let genderNode = divNode.genders.find((g) => g.genderId === genderId);
      if (!genderNode) {
        genderNode = {
          genderId,
          genderName,
          categories: [],
          totals: { quantity: 0, totalCost: 0, avgUnitCost: 0, totalRevenue: 0, grossProfit: 0, profitMargin: 0 },
        };
        divNode.genders.push(genderNode);
      }

      // 4. Category Level
      let catNode = genderNode.categories.find((c) => c.categoryId === catId);
      if (!catNode) {
        catNode = {
          categoryId: catId,
          categoryName: catName,
          products: [],
          totals: { quantity: 0, totalCost: 0, avgUnitCost: 0, totalRevenue: 0, grossProfit: 0, profitMargin: 0 },
        };
        genderNode.categories.push(catNode);
      }

      // 5. Product Level
      let prodNode = catNode.products.find((p) => p.sku === sku);
      if (!prodNode) {
        prodNode = {
          sku,
          description: desc,
          productLabel: desc,
          sizes: [],
          totals: { quantity: 0, totalCost: 0, avgUnitCost: 0, totalRevenue: 0, grossProfit: 0, profitMargin: 0 },
        };
        catNode.products.push(prodNode);
      }

      // 6. Variant Level
      let sizeItem = prodNode.sizes.find((s) => s.size === sizeName && s.color === colorName && s.barCode === barCode);
      if (!sizeItem) {
        sizeItem = {
          id: `pos-${sle.id}`,
          size: sizeName,
          color: colorName,
          barCode,
          quantity: 0,
          costPrice: unitCost,
          totalCost: 0,
          unitPrice,
          totalRevenue: 0,
          grossProfit: 0,
          profitMargin: 0,
        };
        prodNode.sizes.push(sizeItem);
      }

      sizeItem.quantity += qty;
      sizeItem.totalCost = Math.round((sizeItem.totalCost + totalCost) * 100) / 100;
      sizeItem.totalRevenue = Math.round((sizeItem.totalRevenue + totalRevenue) * 100) / 100;
      sizeItem.grossProfit = Math.round((sizeItem.totalRevenue - sizeItem.totalCost) * 100) / 100;
      sizeItem.profitMargin = sizeItem.totalRevenue !== 0 ? Math.round((sizeItem.grossProfit / sizeItem.totalRevenue) * 10000) / 100 : 0;

      prodNode.totals.quantity += qty;
      prodNode.totals.totalCost = Math.round((prodNode.totals.totalCost + totalCost) * 100) / 100;
      prodNode.totals.totalRevenue = Math.round((prodNode.totals.totalRevenue + totalRevenue) * 100) / 100;

      catNode.totals.quantity += qty;
      catNode.totals.totalCost = Math.round((catNode.totals.totalCost + totalCost) * 100) / 100;
      catNode.totals.totalRevenue = Math.round((catNode.totals.totalRevenue + totalRevenue) * 100) / 100;

      genderNode.totals.quantity += qty;
      genderNode.totals.totalCost = Math.round((genderNode.totals.totalCost + totalCost) * 100) / 100;
      genderNode.totals.totalRevenue = Math.round((genderNode.totals.totalRevenue + totalRevenue) * 100) / 100;

      divNode.totals.quantity += qty;
      divNode.totals.totalCost = Math.round((divNode.totals.totalCost + totalCost) * 100) / 100;
      divNode.totals.totalRevenue = Math.round((divNode.totals.totalRevenue + totalRevenue) * 100) / 100;

      brandNode.totals.quantity += qty;
      brandNode.totals.totalCost = Math.round((brandNode.totals.totalCost + totalCost) * 100) / 100;
      brandNode.totals.totalRevenue = Math.round((brandNode.totals.totalRevenue + totalRevenue) * 100) / 100;
    }

    // 2. Process Delivery Challans (Wholesale Sales)
    for (const dc of dcLedgerEntries) {
      if (!dc.item) continue;
      const locName = (dc.locationId && locationMap.get(dc.locationId)) || 'Main Location';
      locationsSet.add(dc.locationId || 'default');

      const qty = Math.abs(Number(dc.qty || 1));
      const unitCost = itemCostMap.get(dc.item.id) ?? Number(dc.item.unitCost || 0);
      const totalCost = Math.round(qty * unitCost * 100) / 100;
      const unitPrice = Number(dc.rate || dc.item.unitPrice || 0);

      const taxPercent = 18;
      const taxDivisor = 1 + taxPercent / 100;
      const wostPerUnit = unitPrice / taxDivisor;
      const totalRevenue = Math.round(wostPerUnit * qty * 100) / 100;

      const grossProfit = Math.round((totalRevenue - totalCost) * 100) / 100;
      const profitMargin = totalRevenue !== 0 ? Math.round((grossProfit / totalRevenue) * 10000) / 100 : 0;

      const brandName = dc.item.brand?.name || 'Unassigned Brand';
      const brandId = dc.item.brand?.id || 'brand-unassigned';
      const divName = dc.item.division?.name || 'Unassigned Division';
      const divId = dc.item.division?.id || 'div-unassigned';
      const genderName = dc.item.gender?.name || 'Unassigned Gender';
      const genderId = dc.item.gender?.id || 'gender-unassigned';
      const catName = dc.item.category?.name || 'Unassigned Category';
      const catId = dc.item.category?.id || 'cat-unassigned';
      const silName = dc.item.silhouette?.name || 'Unassigned Silhouette';
      const sku = dc.item.sku || 'UNKNOWN-SKU';
      const desc = dc.item.description || 'No Description';
      const sizeName = dc.item.size?.name || 'N/A';
      const colorName = dc.item.color?.name || 'N/A';
      const barCode = dc.item.barCode || '';

      flatItemsList.push({
        id: `dc-${dc.id}`,
        brand: brandName,
        division: divName,
        category: catName,
        gender: genderName,
        silhouette: silName,
        sku,
        articleName: desc,
        color: colorName,
        size: sizeName,
        barCode,
        locationName: locName,
        quantity: qty,
        unitCost,
        totalCost,
        unitPrice,
        totalRevenue,
        grossProfit,
        profitMargin,
      });

      // 1. Brand Level
      let brandNode = brandsList.find((b) => b.brandId === brandId);
      if (!brandNode) {
        brandNode = {
          brandId,
          brandName,
          divisions: [],
          totals: { quantity: 0, totalCost: 0, avgUnitCost: 0, totalRevenue: 0, grossProfit: 0, profitMargin: 0 },
        };
        brandsList.push(brandNode);
      }

      // 2. Division Level
      let divNode = brandNode.divisions.find((d) => d.divisionId === divId);
      if (!divNode) {
        divNode = {
          divisionId: divId,
          divisionName: divName,
          genders: [],
          totals: { quantity: 0, totalCost: 0, avgUnitCost: 0, totalRevenue: 0, grossProfit: 0, profitMargin: 0 },
        };
        brandNode.divisions.push(divNode);
      }

      // 3. Gender Level
      let genderNode = divNode.genders.find((g) => g.genderId === genderId);
      if (!genderNode) {
        genderNode = {
          genderId,
          genderName,
          categories: [],
          totals: { quantity: 0, totalCost: 0, avgUnitCost: 0, totalRevenue: 0, grossProfit: 0, profitMargin: 0 },
        };
        divNode.genders.push(genderNode);
      }

      // 4. Category Level
      let catNode = genderNode.categories.find((c) => c.categoryId === catId);
      if (!catNode) {
        catNode = {
          categoryId: catId,
          categoryName: catName,
          products: [],
          totals: { quantity: 0, totalCost: 0, avgUnitCost: 0, totalRevenue: 0, grossProfit: 0, profitMargin: 0 },
        };
        genderNode.categories.push(catNode);
      }

      // 5. Product Level
      let prodNode = catNode.products.find((p) => p.sku === sku);
      if (!prodNode) {
        prodNode = {
          sku,
          description: desc,
          productLabel: desc,
          sizes: [],
          totals: { quantity: 0, totalCost: 0, avgUnitCost: 0, totalRevenue: 0, grossProfit: 0, profitMargin: 0 },
        };
        catNode.products.push(prodNode);
      }

      // 6. Variant Level
      let sizeItem = prodNode.sizes.find((s) => s.size === sizeName && s.color === colorName && s.barCode === barCode);
      if (!sizeItem) {
        sizeItem = {
          id: `dc-${dc.id}`,
          size: sizeName,
          color: colorName,
          barCode,
          quantity: 0,
          costPrice: unitCost,
          totalCost: 0,
          unitPrice,
          totalRevenue: 0,
          grossProfit: 0,
          profitMargin: 0,
        };
        prodNode.sizes.push(sizeItem);
      }

      sizeItem.quantity += qty;
      sizeItem.totalCost = Math.round((sizeItem.totalCost + totalCost) * 100) / 100;
      sizeItem.totalRevenue = Math.round((sizeItem.totalRevenue + totalRevenue) * 100) / 100;
      sizeItem.grossProfit = Math.round((sizeItem.totalRevenue - sizeItem.totalCost) * 100) / 100;
      sizeItem.profitMargin = sizeItem.totalRevenue !== 0 ? Math.round((sizeItem.grossProfit / sizeItem.totalRevenue) * 10000) / 100 : 0;

      prodNode.totals.quantity += qty;
      prodNode.totals.totalCost = Math.round((prodNode.totals.totalCost + totalCost) * 100) / 100;
      prodNode.totals.totalRevenue = Math.round((prodNode.totals.totalRevenue + totalRevenue) * 100) / 100;

      catNode.totals.quantity += qty;
      catNode.totals.totalCost = Math.round((catNode.totals.totalCost + totalCost) * 100) / 100;
      catNode.totals.totalRevenue = Math.round((catNode.totals.totalRevenue + totalRevenue) * 100) / 100;

      genderNode.totals.quantity += qty;
      genderNode.totals.totalCost = Math.round((genderNode.totals.totalCost + totalCost) * 100) / 100;
      genderNode.totals.totalRevenue = Math.round((genderNode.totals.totalRevenue + totalRevenue) * 100) / 100;

      divNode.totals.quantity += qty;
      divNode.totals.totalCost = Math.round((divNode.totals.totalCost + totalCost) * 100) / 100;
      divNode.totals.totalRevenue = Math.round((divNode.totals.totalRevenue + totalRevenue) * 100) / 100;

      brandNode.totals.quantity += qty;
      brandNode.totals.totalCost = Math.round((brandNode.totals.totalCost + totalCost) * 100) / 100;
      brandNode.totals.totalRevenue = Math.round((brandNode.totals.totalRevenue + totalRevenue) * 100) / 100;
    }

    // 3. Deduct Sales Returns from StockLedger (Sales Returns)
    for (const entry of returnLedgerEntries) {
      if (!entry.item) continue;
      const locName = (entry.locationId && locationMap.get(entry.locationId)) || 'Main Location';
      locationsSet.add(entry.locationId || 'default');

      const voucher = voucherMap.get(entry.referenceId);
      const matchedPrItem = voucher?.posReturn?.items?.find((oi: any) => oi.itemId === entry.itemId);
      const originalOi = matchedPrItem || voucher?.sourceOrder?.items?.find((oi: any) => oi.itemId === entry.itemId);

      const retQty = Math.abs(Number(entry.qty || 1));
      const netQty = -retQty;
      const unitCost = itemCostMap.get(entry.item.id) ?? Number(entry.item.unitCost || 0);
      const netCost = -Math.round(retQty * unitCost * 100) / 100;

      const unitPrice = originalOi ? Number(originalOi.unitPrice || 0) : Number(entry.item.unitPrice || 0);
      const taxPercent = originalOi ? Number((originalOi as any).taxPercent || (originalOi as any).taxRate || 0) : 18;
      const calculatedTaxPct = taxPercent > 0 ? taxPercent : 18;
      const taxDivisor = 1 + calculatedTaxPct / 100;
      const wostPerUnit = unitPrice / taxDivisor;
      const netRevenue = -Math.round(wostPerUnit * retQty * 100) / 100;

      const brandName = entry.item.brand?.name || 'Unassigned Brand';
      const brandId = entry.item.brand?.id || 'brand-unassigned';

      const divName = entry.item.division?.name || 'Unassigned Division';
      const divId = entry.item.division?.id || 'div-unassigned';

      const genderName = entry.item.gender?.name || 'Unassigned Gender';
      const genderId = entry.item.gender?.id || 'gender-unassigned';

      const catName = entry.item.category?.name || 'Unassigned Category';
      const catId = entry.item.category?.id || 'cat-unassigned';

      const silName = entry.item.silhouette?.name || 'Unassigned Silhouette';

      const sku = entry.item.sku || 'UNKNOWN-SKU';
      const desc = entry.item.description || 'No Description';
      const sizeName = entry.item.size?.name || 'N/A';
      const colorName = entry.item.color?.name || 'N/A';
      const barCode = entry.item.barCode || '';

      flatItemsList.push({
        id: `ret-${entry.id}`,
        brand: brandName,
        division: divName,
        category: catName,
        gender: genderName,
        silhouette: silName,
        sku,
        articleName: desc,
        color: colorName,
        size: sizeName,
        barCode,
        locationName: locName,
        quantity: netQty,
        unitCost,
        totalCost: netCost,
        unitPrice,
        totalRevenue: netRevenue,
        grossProfit: Math.round((netRevenue - netCost) * 100) / 100,
        profitMargin: netRevenue !== 0 ? Math.round(((netRevenue - netCost) / netRevenue) * 10000) / 100 : 0,
      });

      // 1. Brand Level
      let brandNode = brandsList.find((b) => b.brandId === brandId);
      if (!brandNode) {
        brandNode = {
          brandId,
          brandName,
          divisions: [],
          totals: { quantity: 0, totalCost: 0, avgUnitCost: 0, totalRevenue: 0, grossProfit: 0, profitMargin: 0 },
        };
        brandsList.push(brandNode);
      }

      // 2. Division Level
      let divNode = brandNode.divisions.find((d) => d.divisionId === divId);
      if (!divNode) {
        divNode = {
          divisionId: divId,
          divisionName: divName,
          genders: [],
          totals: { quantity: 0, totalCost: 0, avgUnitCost: 0, totalRevenue: 0, grossProfit: 0, profitMargin: 0 },
        };
        brandNode.divisions.push(divNode);
      }

      // 3. Gender Level
      let genderNode = divNode.genders.find((g) => g.genderId === genderId);
      if (!genderNode) {
        genderNode = {
          genderId,
          genderName,
          categories: [],
          totals: { quantity: 0, totalCost: 0, avgUnitCost: 0, totalRevenue: 0, grossProfit: 0, profitMargin: 0 },
        };
        divNode.genders.push(genderNode);
      }

      // 4. Category Level
      let catNode = genderNode.categories.find((c) => c.categoryId === catId);
      if (!catNode) {
        catNode = {
          categoryId: catId,
          categoryName: catName,
          products: [],
          totals: { quantity: 0, totalCost: 0, avgUnitCost: 0, totalRevenue: 0, grossProfit: 0, profitMargin: 0 },
        };
        genderNode.categories.push(catNode);
      }

      // 5. Product Level
      let prodNode = catNode.products.find((p) => p.sku === sku);
      if (!prodNode) {
        prodNode = {
          sku,
          description: desc,
          productLabel: desc,
          sizes: [],
          totals: { quantity: 0, totalCost: 0, avgUnitCost: 0, totalRevenue: 0, grossProfit: 0, profitMargin: 0 },
        };
        catNode.products.push(prodNode);
      }

      // 6. Variant Level
      let sizeItem = prodNode.sizes.find((s) => s.size === sizeName && s.color === colorName && s.barCode === barCode);
      if (!sizeItem) {
        sizeItem = {
          id: `ret-${entry.id}`,
          size: sizeName,
          color: colorName,
          barCode,
          quantity: 0,
          costPrice: unitCost,
          totalCost: 0,
          unitPrice,
          totalRevenue: 0,
          grossProfit: 0,
          profitMargin: 0,
        };
        prodNode.sizes.push(sizeItem);
      }

      sizeItem.quantity += netQty;
      sizeItem.totalCost = Math.round((sizeItem.totalCost + netCost) * 100) / 100;
      sizeItem.totalRevenue = Math.round((sizeItem.totalRevenue + netRevenue) * 100) / 100;
      sizeItem.grossProfit = Math.round((sizeItem.totalRevenue - sizeItem.totalCost) * 100) / 100;
      sizeItem.profitMargin = sizeItem.totalRevenue !== 0 ? Math.round((sizeItem.grossProfit / sizeItem.totalRevenue) * 10000) / 100 : 0;

      prodNode.totals.quantity += netQty;
      prodNode.totals.totalCost = Math.round((prodNode.totals.totalCost + netCost) * 100) / 100;
      prodNode.totals.totalRevenue = Math.round((prodNode.totals.totalRevenue + netRevenue) * 100) / 100;

      catNode.totals.quantity += netQty;
      catNode.totals.totalCost = Math.round((catNode.totals.totalCost + netCost) * 100) / 100;
      catNode.totals.totalRevenue = Math.round((catNode.totals.totalRevenue + netRevenue) * 100) / 100;

      genderNode.totals.quantity += netQty;
      genderNode.totals.totalCost = Math.round((genderNode.totals.totalCost + netCost) * 100) / 100;
      genderNode.totals.totalRevenue = Math.round((genderNode.totals.totalRevenue + netRevenue) * 100) / 100;

      divNode.totals.quantity += netQty;
      divNode.totals.totalCost = Math.round((divNode.totals.totalCost + netCost) * 100) / 100;
      divNode.totals.totalRevenue = Math.round((divNode.totals.totalRevenue + netRevenue) * 100) / 100;

      brandNode.totals.quantity += netQty;
      brandNode.totals.totalCost = Math.round((brandNode.totals.totalCost + netCost) * 100) / 100;
      brandNode.totals.totalRevenue = Math.round((brandNode.totals.totalRevenue + netRevenue) * 100) / 100;
    }

    await onProgress?.(85, 'Finalizing node metrics & grand totals...');

    for (const brand of brandsList) {
      calculateTotals(brand.totals);
      for (const div of brand.divisions) {
        calculateTotals(div.totals);
        for (const gender of div.genders) {
          calculateTotals(gender.totals);
          for (const cat of gender.categories) {
            calculateTotals(cat.totals);
            for (const prod of cat.products) {
              calculateTotals(prod.totals);
            }
          }
        }
      }
    }

    const grandTotals = brandsList.reduce(
      (acc, b) => {
        acc.quantity += b.totals.quantity;
        acc.totalCost += b.totals.totalCost;
        acc.totalRevenue += b.totals.totalRevenue;
        return acc;
      },
      { quantity: 0, totalCost: 0, avgUnitCost: 0, totalRevenue: 0, grossProfit: 0, profitMargin: 0 },
    );
    calculateTotals(grandTotals);

    return {
      brands: brandsList,
      flatItems: flatItemsList,
      grandTotals,
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
      meta: {
        totalItems: flatItemsList.length,
        locationsCount: locationsSet.size,
      },
    };
  }

  async queueExport(opts: QueueCostOfSalesExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const ext = opts.format === 'pdf' ? 'pdf' : 'xlsx';

    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: `cost-of-sales-${new Date().toISOString().slice(0, 10)}.${ext}`,
        filePath: path.join('uploads', 'exports', `export-${jobId}.${ext}`),
        moduleName: 'COST_OF_SALES_REPORT',
        status: 'PENDING',
      },
    });

    await this.exportQueue.add(
      {
        jobId,
        userId: opts.userId,
        tenantId,
        tenantDbUrl,
        locationId: opts.locationId,
        startDate: opts.startDate,
        endDate: opts.endDate,
        format: opts.format,
        exportType: opts.exportType || 'hierarchical',
        search: opts.search,
        previewJobId: opts.previewJobId,
      },
      {
        jobId,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
        timeout: 2 * 60 * 60 * 1000,
      },
    );

    this.logger.log(`[CostOfSalesExport] Queued job ${jobId} for user ${opts.userId} (format: ${opts.format})`);
    return { jobId };
  }

  async registerClientGeneratedExport(opts: {
    userId: string;
    fileName: string;
    fileBuffer: Buffer;
    mimeType: string;
  }): Promise<{ jobId: string; s3Url?: string }> {
    const jobId = uuidv4();
    const ext = opts.fileName.endsWith('.pdf') ? 'pdf' : 'xlsx';
    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const tempFilePath = path.join(exportDir, `client-export-${jobId}.${ext}`);

    fs.writeFileSync(tempFilePath, opts.fileBuffer);

    const historyRecord = await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: opts.fileName,
        filePath: path.join('uploads', 'exports', `client-export-${jobId}.${ext}`),
        moduleName: 'COST_OF_SALES_REPORT',
        status: 'PENDING',
      },
    });

    try {
      const s3Url = await this.exportHistoryService.completeAndUploadExport(
        this.prisma,
        jobId,
        tempFilePath,
        opts.fileName,
        opts.mimeType,
      );
      return { jobId, s3Url };
    } catch (err: any) {
      this.logger.warn(`Failed S3 upload for client export ${jobId}: ${err.message}. Ephemeral file saved locally.`);
      await this.prisma.exportHistory.update({
        where: { id: jobId },
        data: { status: 'COMPLETED' },
      });
      return { jobId };
    }
  }

  async getJobStatus(jobId: string): Promise<{ state: string; progress: number }> {
    const job = await this.exportQueue.getJob(jobId);
    if (!job) throw new NotFoundException(`Export job ${jobId} not found`);
    const state = await job.getState();
    const progress = typeof job.progress() === 'number' ? (job.progress() as number) : 0;
    return { state, progress };
  }

  async streamExportFile(jobId: string, res: any): Promise<void> {
    const record = await this.prisma.exportHistory.findUnique({
      where: { id: jobId },
      select: { fileName: true, filePath: true },
    });

    if (!record) {
      throw new NotFoundException(`Export record ${jobId} not found`);
    }

    try {
      await this.prisma.exportHistory.update({
        where: { id: jobId },
        data: { downloadCount: { increment: 1 } },
      });
    } catch (err: any) {
      this.logger.warn(`Could not update export download count for job ${jobId}: ${err.message}`);
    }

    if (record.filePath.startsWith('s3://')) {
      const s3Key = record.filePath.replace('s3://', '');
      const signedUrl = await this.uploadService.getSignedUrlForDownload(s3Key);
      return res.redirect(signedUrl, 302);
    }

    if (record.filePath.startsWith('http://') || record.filePath.startsWith('https://')) {
      return res.redirect(record.filePath, 302);
    }

    const filePath = path.join(process.cwd(), record.filePath);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Export file not found.');
    }

    const stat = fs.statSync(filePath);
    const stream = fs.createReadStream(filePath);

    const isPdf = record.fileName.endsWith('.pdf');
    res.header('Content-Type', isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename="${record.fileName}"`);
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(stream);
  }
}
