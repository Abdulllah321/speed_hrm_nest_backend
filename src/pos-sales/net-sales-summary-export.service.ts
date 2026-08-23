import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { UploadService } from '../upload/upload.service';
import { ExportHistoryService } from '../warehouse/export-history/export-history.service';

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

export interface NetSalesSummaryTotals {
  orderCount: number;
  totalItemsSold: number;
  totalItemsReturned: number;
  netItems: number;
  grossSalesAmount: number;
  returnAmount: number;
  discountAmount: number;
  taxAmount: number;
  netSalesAmount: number;
}

export interface NetSalesSummaryLineItem {
  id: string;
  sku: string;
  barCode: string;
  description: string;
  categoryName: string;
  brandName: string;
  divisionName: string;
  genderName: string;
  silhouetteName: string;
  sizeName: string;
  colorName: string;
  soldQty: number;
  returnQty: number;
  netQty: number;
  grossAmount: number;
  returnAmount: number;
  discountAmount: number;
  taxAmount: number;
  netAmount: number;
}

export interface NetSalesSummaryCategoryNode {
  categoryName: string;
  brandName: string;
  divisionName?: string;
  genderName?: string;
  silhouetteName?: string;
  totals: NetSalesSummaryTotals;
  items: NetSalesSummaryLineItem[];
}

export interface NetSalesSummaryLocationNode {
  locationKey: string;
  locationId?: string;
  locationName: string;
  categories: NetSalesSummaryCategoryNode[];
  totals: NetSalesSummaryTotals;
}

export interface NetSalesSummaryFlatRecord {
  locationName: string;
  categoryName: string;
  brandName: string;
  divisionName: string;
  genderName: string;
  silhouetteName: string;
  sku: string;
  barCode: string;
  description: string;
  sizeName: string;
  colorName: string;
  soldQty: number;
  returnQty: number;
  netQty: number;
  grossAmount: number;
  returnAmount: number;
  discountAmount: number;
  taxAmount: number;
  netAmount: number;
}

export interface NetSalesSummaryReportResult {
  reportType: 'merged' | 'separate';
  locations?: NetSalesSummaryLocationNode[];
  categories: NetSalesSummaryCategoryNode[];
  flatItems: NetSalesSummaryFlatRecord[];
  grandTotals: NetSalesSummaryTotals;
  dateRange: { startDate?: string; endDate?: string };
  locationNames: string;
}

export interface QueueNetSalesSummaryExportOptions {
  userId: string;
  locationId?: string;
  startDate?: string;
  endDate?: string;
  cashierUserId?: string;
  format: 'xlsx' | 'pdf';
  summaryOnly?: boolean;
  showSalesperson?: boolean;
  showYear?: boolean;
  showMonth?: boolean;
  showDay?: boolean;
  showDocument?: boolean;
  showBrand?: boolean;
  showDivision?: boolean;
  showSalesTax?: boolean;
  showCategory?: boolean;
  showGender?: boolean;
  showSilhouette?: boolean;
  showArticle?: boolean;
  showVariant?: boolean;
}

@Injectable()
export class NetSalesSummaryExportService {
  private readonly logger = new Logger(NetSalesSummaryExportService.name);
  private readonly previewStorageDir = path.join(process.cwd(), 'uploads', 'report-previews');

  constructor(
    @InjectQueue('net-sales-summary-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly prismaMaster: PrismaMasterService,
    private readonly uploadService: UploadService,
    private readonly exportHistoryService: ExportHistoryService,
  ) {
    if (!fs.existsSync(this.previewStorageDir)) {
      fs.mkdirSync(this.previewStorageDir, { recursive: true });
    }
  }

  async queueReportPreview(opts: {
    userId: string;
    locationId?: string;
    startDate?: string;
    endDate?: string;
    cashierUserId?: string;
    reportType?: 'merged' | 'separate';
    search?: string;
    paymentModeGroup?: string;
    minAmount?: number;
    maxAmount?: number;
    fbrOnly?: boolean;
  }): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    await this.exportQueue.add(
      'generate-net-sales-summary-preview',
      {
        jobId,
        userId: opts.userId,
        tenantId,
        tenantDbUrl,
        locationId: opts.locationId,
        startDate: opts.startDate,
        endDate: opts.endDate,
        cashierUserId: opts.cashierUserId,
        reportType: opts.reportType || 'merged',
        search: opts.search,
        paymentModeGroup: opts.paymentModeGroup,
        minAmount: opts.minAmount,
        maxAmount: opts.maxAmount,
        fbrOnly: opts.fbrOnly,
      },
      {
        jobId: `preview-${jobId}`,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
        timeout: 60 * 60 * 1000,
      },
    );

    this.logger.log(`[NetSalesSummaryReport] Queued preview job ${jobId} for user ${opts.userId}`);
    return { jobId };
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
    const job = await this.exportQueue.getJob(`preview-${jobId}`) || await this.exportQueue.getJob(jobId);
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
      const idx = allJobs.findIndex((j) => j.id?.toString().includes(jobId));
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

  async saveReportPreviewResult(jobId: string, result: NetSalesSummaryReportResult): Promise<void> {
    const jsonStr = JSON.stringify(result);
    const compressed = await gzipAsync(Buffer.from(jsonStr, 'utf8'));
    const filePath = path.join(this.previewStorageDir, `net-sales-summary-preview-${jobId}.json.gz`);
    await fs.promises.writeFile(filePath, compressed);
  }

  async getReportPreviewResult(jobId: string): Promise<NetSalesSummaryReportResult | null> {
    const filePath = path.join(this.previewStorageDir, `net-sales-summary-preview-${jobId}.json.gz`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const compressed = await fs.promises.readFile(filePath);
    const decompressed = await gunzipAsync(compressed);
    return JSON.parse(decompressed.toString('utf8'));
  }

  async generateNetSalesSummaryReportDataInternal(
    prisma: PrismaService,
    opts: {
      locationId?: string;
      startDate?: string;
      endDate?: string;
      cashierUserId?: string;
      reportType?: 'merged' | 'separate';
      search?: string;
      paymentModeGroup?: string;
      minAmount?: number;
      maxAmount?: number;
      fbrOnly?: boolean;
      onProgress?: (percent: number, message: string) => Promise<void> | void;
    },
  ): Promise<NetSalesSummaryReportResult> {
    const {
      locationId,
      startDate: startStr,
      endDate: endStr,
      cashierUserId,
      reportType = 'merged',
      search,
      paymentModeGroup,
      minAmount,
      maxAmount,
      fbrOnly,
      onProgress,
    } = opts;

    const isSeparate = reportType === 'separate';
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

    const locIds = locationId ? locationId.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const locationWhere = locIds.length > 1 ? { in: locIds } : locIds.length === 1 ? locIds[0] : undefined;

    await onProgress?.(15, 'Loading outlet metadata & cashier user profiles...');

    const allLocations = await prisma.location.findMany({ select: { id: true, name: true } });
    const locationMap = new Map<string, string>();
    for (const l of allLocations) locationMap.set(l.id, l.name);

    let locationNames = '';
    if (locIds.length > 0) {
      const locs = allLocations.filter((l) => locIds.includes(l.id));
      locationNames = locs.map((l) => l.name).join(', ');
    }
    if (!locationNames) locationNames = 'All Outlets (Stores)';

    await onProgress?.(35, 'Querying sales & returns database records...');

    const where: any = {
      status: { notIn: ['hold', 'hold_expired', 'hold_cancelled'] },
      createdAt: { gte: startDate, lte: endDate },
    };

    if (locationWhere) where.locationId = locationWhere;
    if (cashierUserId) where.cashierUserId = cashierUserId;
    if (fbrOnly) where.fbrInvoiceNumber = { not: null };
    if (paymentModeGroup) {
      where.paymentMethod = { equals: paymentModeGroup, mode: 'insensitive' };
    }
    if (minAmount !== undefined || maxAmount !== undefined) {
      where.grandTotal = {};
      if (minAmount !== undefined) where.grandTotal.gte = Number(minAmount);
      if (maxAmount !== undefined) where.grandTotal.lte = Number(maxAmount);
    }
    if (search && search.trim()) {
      const s = search.trim();
      where.OR = [
        { orderNumber: { contains: s, mode: 'insensitive' } },
        { returnNumber: { contains: s, mode: 'insensitive' } },
        { customer: { name: { contains: s, mode: 'insensitive' } } },
      ];
    }

    const rawOrders = await prisma.salesOrder.findMany({
      where,
      include: {
        items: {
          include: {
            item: {
              select: {
                description: true,
                sku: true,
                barCode: true,
                category: { select: { name: true } },
                brand: { select: { name: true } },
                division: { select: { name: true } },
                gender: { select: { name: true } },
                silhouette: { select: { name: true } },
                size: { select: { name: true } },
                color: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    await onProgress?.(70, 'Compiling Net Sales Summary hierarchy matrix...');

    const createEmptyTotals = (): NetSalesSummaryTotals => ({
      orderCount: 0,
      totalItemsSold: 0,
      totalItemsReturned: 0,
      netItems: 0,
      grossSalesAmount: 0,
      returnAmount: 0,
      discountAmount: 0,
      taxAmount: 0,
      netSalesAmount: 0,
    });

    const addTotals = (target: NetSalesSummaryTotals, source: NetSalesSummaryTotals) => {
      target.orderCount += source.orderCount;
      target.totalItemsSold += source.totalItemsSold;
      target.totalItemsReturned += source.totalItemsReturned;
      target.netItems += source.netItems;
      target.grossSalesAmount += source.grossSalesAmount;
      target.returnAmount += source.returnAmount;
      target.discountAmount += source.discountAmount;
      target.taxAmount += source.taxAmount;
      target.netSalesAmount += source.netSalesAmount;
    };

    const grandTotals = createEmptyTotals();
    const flatItems: NetSalesSummaryFlatRecord[] = [];

    const globalCategoryNodesMap = new Map<string, NetSalesSummaryCategoryNode>();
    const locationNodesMap = new Map<string, NetSalesSummaryLocationNode>();

    for (const order of rawOrders) {
      const isReturnOrder = Boolean(order.returnNumber || order.refundNumber);
      const locName = order.locationId ? locationMap.get(order.locationId) || 'Main Outlet' : 'Main Outlet';
      const locKey = order.locationId ? `loc:${order.locationId}` : 'main-outlet';

      let locNode = locationNodesMap.get(locKey);
      if (isSeparate && !locNode) {
        locNode = {
          locationKey: locKey,
          locationId: order.locationId || undefined,
          locationName: locName,
          categories: [],
          totals: createEmptyTotals(),
        };
        locationNodesMap.set(locKey, locNode);
      }

      for (const item of order.items) {
        const catName = item.item?.category?.name || 'Unassigned Category';
        const brandName = item.item?.brand?.name || 'Default Brand';
        const divisionName = item.item?.division?.name || 'Default Division';
        const genderName = item.item?.gender?.name || 'Default Gender';
        const silhouetteName = item.item?.silhouette?.name || 'Default Silhouette';
        const qty = Number(item.quantity || 0);
        const unitPrice = Number(item.unitPrice || 0);
        const lineTotal = Number(item.lineTotal || 0);
        const disc = Number(item.discountAmount || 0);
        const tax = Number(item.taxAmount || 0);

        const soldQty = isReturnOrder ? 0 : qty;
        const returnQty = isReturnOrder ? qty : 0;
        const netQty = soldQty - returnQty;

        const grossAmt = isReturnOrder ? 0 : unitPrice * soldQty;
        const retAmt = isReturnOrder ? lineTotal : 0;
        const netSalesAmt = isReturnOrder ? -lineTotal : lineTotal;

        const lineTotals: NetSalesSummaryTotals = {
          orderCount: 1,
          totalItemsSold: soldQty,
          totalItemsReturned: returnQty,
          netItems: netQty,
          grossSalesAmount: grossAmt,
          returnAmount: retAmt,
          discountAmount: disc,
          taxAmount: tax,
          netSalesAmount: netSalesAmt,
        };

        addTotals(grandTotals, lineTotals);

        const lineItemNode: NetSalesSummaryLineItem = {
          id: item.id,
          sku: item.item?.sku || item.item?.barCode || 'NO-SKU',
          barCode: item.item?.barCode || item.item?.sku || '-',
          description: item.item?.description || item.item?.sku || 'Article',
          categoryName: catName,
          brandName,
          divisionName,
          genderName,
          silhouetteName,
          sizeName: item.item?.size?.name || 'Default',
          colorName: item.item?.color?.name || 'Default',
          soldQty,
          returnQty,
          netQty,
          grossAmount: grossAmt,
          returnAmount: retAmt,
          discountAmount: disc,
          taxAmount: tax,
          netAmount: netSalesAmt,
        };

        flatItems.push({
          locationName: locName,
          categoryName: catName,
          brandName,
          divisionName,
          genderName,
          silhouetteName,
          sku: lineItemNode.sku,
          barCode: lineItemNode.barCode,
          description: lineItemNode.description,
          sizeName: lineItemNode.sizeName,
          colorName: lineItemNode.colorName,
          soldQty,
          returnQty,
          netQty,
          grossAmount: grossAmt,
          returnAmount: retAmt,
          discountAmount: disc,
          taxAmount: tax,
          netAmount: netSalesAmt,
        });

        // Add to global category map
        let globalCat = globalCategoryNodesMap.get(catName);
        if (!globalCat) {
          globalCat = {
            categoryName: catName,
            brandName,
            totals: createEmptyTotals(),
            items: [],
          };
          globalCategoryNodesMap.set(catName, globalCat);
        }
        globalCat.items.push(lineItemNode);
        addTotals(globalCat.totals, lineTotals);

        // Add to location map if separate
        if (isSeparate && locNode) {
          let locCat = locNode.categories.find((c) => c.categoryName === catName);
          if (!locCat) {
            locCat = {
              categoryName: catName,
              brandName,
              totals: createEmptyTotals(),
              items: [],
            };
            locNode.categories.push(locCat);
          }
          locCat.items.push(lineItemNode);
          addTotals(locCat.totals, lineTotals);
          addTotals(locNode.totals, lineTotals);
        }
      }
    }

    await onProgress?.(100, 'Net Sales Summary computation complete!');

    return {
      reportType,
      locations: isSeparate ? Array.from(locationNodesMap.values()) : undefined,
      categories: Array.from(globalCategoryNodesMap.values()),
      flatItems,
      grandTotals,
      dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
      locationNames,
    };
  }

  async registerClientGeneratedExport(
    prisma: PrismaService,
    userId: string,
    opts: {
      fileName: string;
      fileBase64: string;
      mimeType: string;
    },
  ): Promise<{ jobId: string; downloadUrl: string }> {
    const jobId = uuidv4();
    const fileBuffer = Buffer.from(opts.fileBase64, 'base64');
    const localDir = path.join(process.cwd(), 'uploads', 'exports');
    await fs.promises.mkdir(localDir, { recursive: true });
    const localPath = path.join(localDir, `${jobId}-${opts.fileName}`);
    await fs.promises.writeFile(localPath, fileBuffer);

    await prisma.exportHistory.create({
      data: {
        id: jobId,
        userId,
        fileName: opts.fileName,
        filePath: localPath,
        moduleName: 'NET_SALES_SUMMARY_REPORT',
        status: 'PENDING',
      },
    });

    const downloadUrl = await this.exportHistoryService.completeAndUploadExport(
      prisma,
      jobId,
      localPath,
      opts.fileName,
      opts.mimeType,
    );

    return { jobId, downloadUrl };
  }

  async queueExport(opts: QueueNetSalesSummaryExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const ext = opts.format === 'pdf' ? 'pdf' : 'xlsx';

    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: `net-sales-summary-${new Date().toISOString().slice(0, 10)}.${ext}`,
        filePath: path.join('uploads', 'exports', `export-${jobId}.${ext}`),
        moduleName: 'NET_SALES_SUMMARY_REPORT',
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
        cashierUserId: opts.cashierUserId,
        format: opts.format,
        summaryOnly: !!opts.summaryOnly,
        showSalesperson: opts.showSalesperson,
        showYear: opts.showYear,
        showMonth: opts.showMonth,
        showDay: opts.showDay,
        showDocument: opts.showDocument,
        showBrand: opts.showBrand,
        showDivision: opts.showDivision,
        showSalesTax: opts.showSalesTax,
        showCategory: opts.showCategory,
        showGender: opts.showGender,
        showSilhouette: opts.showSilhouette,
        showArticle: opts.showArticle,
        showVariant: opts.showVariant,
      },
      {
        jobId,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
        timeout: 2 * 60 * 60 * 1000,
      },
    );

    this.logger.log(`[NetSalesSummaryExport] Queued job ${jobId} for user ${opts.userId} (format: ${opts.format})`);
    return { jobId };
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
      this.logger.warn(`Could not update export history download count for job ${jobId}: ${err.message}`);
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
