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

    const whereSales: any = {
      createdAt: { gte: startDate, lte: endDate },
      status: { notIn: ['voided', 'cancelled', 'VOIDED', 'CANCELLED'] },
    };

    if (locationId && locationId.trim() !== '' && locationId !== 'all') {
      const locationIds = locationId
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (locationIds.length > 0) {
        whereSales.locationId = { in: locationIds };
      }
    }

    if (search && search.trim() !== '') {
      const q = search.trim();
      whereSales.items = {
        some: {
          item: {
            OR: [
              { sku: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
              { barCode: { contains: q, mode: 'insensitive' } },
              { brand: { name: { contains: q, mode: 'insensitive' } } },
              { division: { name: { contains: q, mode: 'insensitive' } } },
              { category: { name: { contains: q, mode: 'insensitive' } } },
            ],
          },
        },
      };
    }

    await onProgress?.(30, 'Fetching sales order line items & store/warehouse details...');

    const [orders, locations] = await Promise.all([
      prisma.salesOrder.findMany({
        where: whereSales,
        select: {
          id: true,
          orderNumber: true,
          createdAt: true,
          locationId: true,
          items: {
            select: {
              id: true,
              quantity: true,
              unitPrice: true,
              lineTotal: true,
              item: {
                select: {
                  id: true,
                  sku: true,
                  barCode: true,
                  description: true,
                  unitCost: true,
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
          },
        },
      }),
      prisma.location.findMany({ select: { id: true, name: true } }),
    ]);

    const locationMap = new Map<string, string>(locations.map((l) => [l.id, l.name]));

    await onProgress?.(65, 'Building cost-of-sales tree & calculating gross profit metrics...');

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
      tot.avgUnitCost = tot.quantity > 0 ? Math.round((tot.totalCost / tot.quantity) * 100) / 100 : 0;
      tot.grossProfit = Math.round((tot.totalRevenue - tot.totalCost) * 100) / 100;
      tot.profitMargin = tot.totalRevenue > 0 ? Math.round((tot.grossProfit / tot.totalRevenue) * 10000) / 100 : 0;
    };

    for (const order of orders) {
      const locName = (order.locationId && locationMap.get(order.locationId)) || 'Main Location';
      locationsSet.add(order.locationId || 'default');

      for (const soi of order.items) {
        if (!soi.item) continue;
        const qty = soi.quantity || 1;
        const unitCost = Number(soi.item.unitCost || 0);
        const totalCost = Math.round(qty * unitCost * 100) / 100;
        const unitPrice = Number(soi.unitPrice || 0);
        const totalRevenue = Number(soi.lineTotal || qty * unitPrice);
        const grossProfit = Math.round((totalRevenue - totalCost) * 100) / 100;
        const profitMargin = totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 10000) / 100 : 0;

        const brandName = soi.item.brand?.name || 'Unassigned Brand';
        const brandId = soi.item.brand?.id || 'brand-unassigned';

        const divName = soi.item.division?.name || 'Unassigned Division';
        const divId = soi.item.division?.id || 'div-unassigned';

        const genderName = soi.item.gender?.name || 'Unassigned Gender';
        const genderId = soi.item.gender?.id || 'gender-unassigned';

        const catName = soi.item.category?.name || 'Unassigned Category';
        const catId = soi.item.category?.id || 'cat-unassigned';

        const silName = soi.item.silhouette?.name || 'Unassigned Silhouette';

        const sku = soi.item.sku || 'UNKNOWN-SKU';
        const desc = soi.item.description || 'No Description';
        const sizeName = soi.item.size?.name || 'N/A';
        const colorName = soi.item.color?.name || 'N/A';
        const barCode = soi.item.barCode || '';

        // Add to flat items dataset
        flatItemsList.push({
          id: soi.id,
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
        let sizeItem = prodNode.sizes.find((s) => s.size === sizeName && s.color === colorName);
        if (!sizeItem) {
          sizeItem = {
            id: soi.id,
            size: sizeName,
            color: colorName,
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
        sizeItem.profitMargin = sizeItem.totalRevenue > 0 ? Math.round((sizeItem.grossProfit / sizeItem.totalRevenue) * 10000) / 100 : 0;

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
