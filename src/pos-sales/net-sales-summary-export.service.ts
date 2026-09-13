import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { pipeline, PassThrough } from 'stream';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { UploadService } from '../upload/upload.service';
import { ExportHistoryService } from '../warehouse/export-history/export-history.service';

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

export interface NetSalesSummaryTotals {
  orderCount: number;
  unitPrice?: number;
  totalItemsSold: number;
  totalItemsReturned: number;
  netItems: number;
  retailSalesValue: number;
  wostAmount: number;
  discountAmount: number;
  valueExSalesTax: number;
  taxAmount: number;
  valueInclSalesTax: number;

  grossSalesAmount: number;
  returnAmount: number;
  netSalesAmount: number;
}

export interface NetSalesSummaryLineItem {
  id: string;
  docNo?: string;
  docDate?: string;
  salesPerson?: string;
  taxRatePercent?: number;
  taxRateName?: string;
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
  unitPrice: number;
  soldQty: number;
  returnQty: number;
  netQty: number;
  retailSalesValue: number;
  wostAmount: number;
  discountAmount: number;
  valueExSalesTax: number;
  taxAmount: number;
  valueInclSalesTax: number;

  grossAmount: number;
  returnAmount: number;
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
  locationId?: string;
  locationName: string;
  docNo?: string;
  docDate?: string;
  salesPerson?: string;
  taxRatePercent?: number;
  taxRateName?: string;
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
  unitPrice?: number;
  soldQty: number;
  returnQty: number;
  netQty: number;
  retailSalesValue?: number;
  wostAmount?: number;
  grossAmount: number;
  returnAmount: number;
  discountAmount: number;
  valueExSalesTax?: number;
  taxAmount: number;
  valueInclSalesTax?: number;
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

  constructor(
    @InjectQueue('net-sales-summary-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly prismaMaster: PrismaMasterService,
    private readonly uploadService: UploadService,
    private readonly exportHistoryService: ExportHistoryService,
  ) {}

  async queueExport(
    opts: QueueNetSalesSummaryExportOptions,
  ): Promise<{ jobId: string; historyId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const dateStr = new Date().toISOString().split('T')[0];
    const ext = opts.format === 'pdf' ? 'pdf' : 'xlsx';
    const fileName = `net-sales-summary-report-${dateStr}.${ext}`;

    const historyRecord = await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName,
        filePath: path.join('uploads', 'exports', `export-${jobId}.${ext}`),
        moduleName: 'NET_SALES_SUMMARY_REPORT',
        status: 'PENDING',
      },
    });

    await this.exportQueue.add(
      {
        jobId,
        tenantId,
        tenantDbUrl,
        ...opts,
      },
      {
        jobId,
        attempts: 3,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    return { jobId, historyId: historyRecord.id };
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
      throw new NotFoundException(`Export record ${jobId} not found in database`);
    }

    try {
      await this.prisma.exportHistory.update({
        where: { id: jobId },
        data: {
          downloadCount: { increment: 1 },
        },
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
      throw new NotFoundException('Export file not found. It may have expired or the job is still running.');
    }

    const stat = fs.statSync(filePath);

    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      this.logger.error(`[NetSalesSummaryExport] Stream error: ${err.message}`);
    });

    const isPdf = record.fileName.endsWith('.pdf');
    res.header('Content-Type', isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename="${record.fileName}"`);
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');

    res.send(stream);
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
        tenantId,
        tenantDbUrl,
        ...opts,
      },
      {
        jobId: `preview-${jobId}`,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    return { jobId };
  }

  async getJobQueueStatus(jobId: string) {
    const job = (await this.exportQueue.getJob(`preview-${jobId}`)) || (await this.exportQueue.getJob(jobId));
    if (!job) {
      return { status: 'completed', progress: 100 };
    }
    const state = await job.getState();
    const progressData = job.progress();
    const progress = typeof progressData === 'number' ? progressData : (progressData as any)?.percent || 0;
    const message = typeof progressData === 'object' ? (progressData as any)?.message : undefined;
    return {
      status: state,
      progress: progress || (state === 'completed' ? 100 : 0),
      message,
      queuePosition: 0,
      waitingCount: 0,
      failedReason: job.failedReason,
    };
  }

  async saveReportPreviewResult(jobId: string, result: NetSalesSummaryReportResult): Promise<void> {
    const previewDir = path.join(process.cwd(), 'uploads', 'previews');
    await fs.promises.mkdir(previewDir, { recursive: true });
    const filePath = path.join(previewDir, `net-sales-summary-preview-${jobId}.json.gz`);

    const jsonStr = JSON.stringify(result);
    const compressed = await gzipAsync(Buffer.from(jsonStr, 'utf8'));
    await fs.promises.writeFile(filePath, compressed);
  }

  async getReportPreviewResult(jobId: string): Promise<NetSalesSummaryReportResult | null> {
    const previewDir = path.join(process.cwd(), 'uploads', 'previews');
    const filePath = path.join(previewDir, `net-sales-summary-preview-${jobId}.json.gz`);

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

    const totalOrderCount = await prisma.salesOrder.count({ where });
    const CHUNK = 1000;
    const rawOrders: any[] = [];
    for (let processed = 0; processed < totalOrderCount; processed += CHUNK) {
      const chunk = await prisma.salesOrder.findMany({
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
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: processed,
        take: CHUNK,
      });
      rawOrders.push(...chunk);
      const percent = Math.min(65, 35 + Math.round((rawOrders.length / (totalOrderCount || 1)) * 30));
      await onProgress?.(percent, `Loaded ${rawOrders.length.toLocaleString()} of ${totalOrderCount.toLocaleString()} sales orders...`);
    }

    const returnLedgerEntries = await prisma.stockLedger.findMany({
      where: {
        referenceType: { in: ['POS_RETURN', 'POS_REFUND', 'POS_EXCHANGE_IN', 'POS_VOID'] },
        createdAt: { gte: startDate, lte: endDate },
        ...(locationWhere ? { locationId: locationWhere } : {}),
      },
      include: {
        item: {
          include: {
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
    });

    const returnRefIds = [...new Set(returnLedgerEntries.map((e) => e.referenceId).filter(Boolean))] as string[];
    const [returnVouchers, returnPosReturns] = await Promise.all([
      returnRefIds.length
        ? await prisma.voucher.findMany({
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

    const sourceOrderIds = [...new Set(returnVouchers.map((v) => v.sourceOrderId).filter(Boolean))] as string[];
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

    await onProgress?.(70, 'Compiling Net Sales Summary hierarchy matrix...');

    const createEmptyTotals = (): NetSalesSummaryTotals => ({
      orderCount: 0,
      unitPrice: 0,
      totalItemsSold: 0,
      totalItemsReturned: 0,
      netItems: 0,
      retailSalesValue: 0,
      wostAmount: 0,
      discountAmount: 0,
      valueExSalesTax: 0,
      taxAmount: 0,
      valueInclSalesTax: 0,
      grossSalesAmount: 0,
      returnAmount: 0,
      netSalesAmount: 0,
    });

    const addTotals = (target: NetSalesSummaryTotals, source: NetSalesSummaryTotals) => {
      target.orderCount += source.orderCount;
      target.totalItemsSold += source.totalItemsSold;
      target.totalItemsReturned += source.totalItemsReturned;
      target.netItems += source.netItems;
      target.retailSalesValue += source.retailSalesValue;
      target.wostAmount += source.wostAmount;
      target.discountAmount += source.discountAmount;
      target.valueExSalesTax += source.valueExSalesTax;
      target.taxAmount += source.taxAmount;
      target.valueInclSalesTax += source.valueInclSalesTax;

      // Legacy field aliases
      target.grossSalesAmount += source.grossSalesAmount;
      target.returnAmount += source.returnAmount;
      target.netSalesAmount += source.netSalesAmount;
    };

    const grandTotals = createEmptyTotals();
    const flatItems: NetSalesSummaryFlatRecord[] = [];

    const globalCategoryNodesMap = new Map<string, NetSalesSummaryCategoryNode>();
    const locationNodesMap = new Map<string, NetSalesSummaryLocationNode>();

    // 1. Process Gross Sales from SalesOrders
    for (const order of rawOrders) {
      const locName = order.locationId ? locationMap.get(order.locationId) || 'Main Outlet' : 'Main Outlet';
      const locKey = order.locationId ? `loc:${order.locationId}` : 'main-outlet';

      const docNo = order.orderNumber || 'N/A';
      const docDate = order.createdAt ? new Date(order.createdAt).toISOString().split('T')[0] : 'N/A';

      let salesPerson = 'Default Cashier';
      if (order.notes) {
        const match = order.notes.match(/SalesPerson:\s*([^|]+)/i);
        if (match) salesPerson = match[1].trim();
      }

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
        const taxPercent = Number((item as any).taxPercent || (item as any).taxRate || 0);

        const soldQty = qty;
        const returnQty = 0;
        const netQty = soldQty;

        const calculatedTaxPct = taxPercent > 0
          ? taxPercent
          : (tax > 0 && (lineTotal - tax) > 0
              ? Math.round((tax / (lineTotal - tax)) * 100 * 100) / 100
              : (tax > 0 ? 18 : 0));
        const taxDivisor = 1 + calculatedTaxPct / 100;

        const grossAmt = unitPrice * soldQty;
        const retAmt = 0;
        const retailSalesValue = unitPrice * netQty;

        const wostPerUnit = unitPrice / taxDivisor;
        const wostAmount = Math.round(wostPerUnit * soldQty * 100) / 100;

        const itemDisc = disc;
        const valueExSalesTax = Math.round((wostAmount - itemDisc) * 100) / 100;
        const taxAmount = tax > 0 ? tax : Math.round((valueExSalesTax * (calculatedTaxPct / 100)) * 100) / 100;
        const valueInclSalesTax = Math.round((valueExSalesTax + taxAmount) * 100) / 100;

        const taxRateName = calculatedTaxPct > 0 ? `${calculatedTaxPct}% Sales Tax Group` : '0% Tax Exempt Group';

        const lineTotals: NetSalesSummaryTotals = {
          orderCount: 1,
          unitPrice,
          totalItemsSold: soldQty,
          totalItemsReturned: 0,
          netItems: netQty,
          retailSalesValue,
          wostAmount,
          discountAmount: itemDisc,
          valueExSalesTax,
          taxAmount: taxAmount,
          valueInclSalesTax,
          grossSalesAmount: grossAmt,
          returnAmount: 0,
          netSalesAmount: valueInclSalesTax,
        };

        addTotals(grandTotals, lineTotals);

        const lineItemNode: NetSalesSummaryLineItem = {
          id: item.id,
          docNo,
          docDate,
          salesPerson,
          taxRatePercent: calculatedTaxPct,
          taxRateName,
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
          unitPrice,
          soldQty,
          returnQty,
          netQty,
          retailSalesValue,
          wostAmount,
          discountAmount: itemDisc,
          valueExSalesTax,
          taxAmount: taxAmount,
          valueInclSalesTax,
          grossAmount: grossAmt,
          returnAmount: retAmt,
          netAmount: valueInclSalesTax,
        };

        flatItems.push({
          locationId: order.locationId || undefined,
          locationName: locName,
          cashierUserId: order.cashierUserId || undefined,
          createdAt: order.createdAt,
          docNo,
          docDate,
          salesPerson,
          taxRatePercent: calculatedTaxPct,
          taxRateName,
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
          unitPrice,
          soldQty,
          returnQty,
          netQty,
          retailSalesValue,
          wostAmount,
          grossAmount: grossAmt,
          returnAmount: retAmt,
          discountAmount: disc,
          valueExSalesTax,
          taxAmount: tax,
          valueInclSalesTax,
          netAmount: valueInclSalesTax,
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

    // 2. Process Returns from StockLedger Entries / Return Vouchers
    for (const entry of returnLedgerEntries) {
      if (!entry.item) continue;
      const voucher = voucherMap.get(entry.referenceId);
      const locName = entry.locationId ? locationMap.get(entry.locationId) || 'Main Outlet' : 'Main Outlet';
      const locKey = entry.locationId ? `loc:${entry.locationId}` : 'main-outlet';

      const docNo = voucher?.code || 'POS-RETURN';
      const docDate = entry.createdAt ? new Date(entry.createdAt).toISOString().split('T')[0] : 'N/A';
      const salesPerson = 'Default Cashier';

      let locNode = locationNodesMap.get(locKey);
      if (isSeparate && !locNode) {
        locNode = {
          locationKey: locKey,
          locationId: entry.locationId || undefined,
          locationName: locName,
          categories: [],
          totals: createEmptyTotals(),
        };
        locationNodesMap.set(locKey, locNode);
      }

      const catName = entry.item.category?.name || 'Unassigned Category';
      const brandName = entry.item.brand?.name || 'Default Brand';
      const divisionName = entry.item.division?.name || 'Default Division';
      const genderName = entry.item.gender?.name || 'Default Gender';
      const silhouetteName = entry.item.silhouette?.name || 'Default Silhouette';

      const matchedPrItem = voucher?.posReturn?.items?.find((pi: any) => pi.itemId === entry.itemId);
      const originalOi = matchedPrItem || voucher?.sourceOrder?.items?.find((oi: any) => oi.itemId === entry.itemId);
      const returnQty = Math.abs(Number(entry.qty || 1));
      const soldQty = 0;
      const netQty = -returnQty;

      const unitPrice = matchedPrItem
        ? Number(matchedPrItem.originalUnitPrice || matchedPrItem.originalPaidPerUnit || 0)
        : originalOi
          ? Number(originalOi.unitPrice || 0)
          : Number(entry.item.unitPrice || 0);
      const taxPercent = matchedPrItem
        ? Number(matchedPrItem.taxPercent || 0)
        : originalOi
          ? Number((originalOi as any).taxPercent || (originalOi as any).taxRate || 0)
          : 18;
      const calculatedTaxPct = taxPercent > 0 ? taxPercent : 18;
      const taxDivisor = 1 + calculatedTaxPct / 100;

      const retailSalesValue = -Math.round(unitPrice * returnQty * 100) / 100;
      const wostPerUnit = unitPrice / taxDivisor;
      const wostAmount = matchedPrItem && Number(matchedPrItem.lineTotalWost) !== 0
        ? -Number(matchedPrItem.lineTotalWost)
        : -Math.round(wostPerUnit * returnQty * 100) / 100;

      const itemDisc = matchedPrItem
        ? -Number(matchedPrItem.discountWost || 0)
        : originalOi
          ? -Math.round((Number(originalOi.discountAmount || 0) / (Number(originalOi.quantity) || 1)) * returnQty * 100) / 100
          : 0;

      const valueExSalesTax = Math.round((wostAmount - itemDisc) * 100) / 100;
      const taxAmount = matchedPrItem
        ? -Number(matchedPrItem.taxAmount || 0)
        : originalOi
          ? -Math.round((Number(originalOi.taxAmount || 0) / (Number(originalOi.quantity) || 1)) * returnQty * 100) / 100
          : Math.round((valueExSalesTax * (calculatedTaxPct / 100)) * 100) / 100;

      const valueInclSalesTax = Math.round((valueExSalesTax + taxAmount) * 100) / 100;
      const taxRateName = calculatedTaxPct > 0 ? `${calculatedTaxPct}% Sales Tax Group` : '0% Tax Exempt Group';

      const lineTotals: NetSalesSummaryTotals = {
        orderCount: 0,
        unitPrice,
        totalItemsSold: 0,
        totalItemsReturned: returnQty,
        netItems: netQty,
        retailSalesValue,
        wostAmount,
        discountAmount: itemDisc,
        valueExSalesTax,
        taxAmount: taxAmount,
        valueInclSalesTax,
        grossSalesAmount: 0,
        returnAmount: -valueInclSalesTax,
        netSalesAmount: valueInclSalesTax,
      };

      addTotals(grandTotals, lineTotals);

      const lineItemNode: NetSalesSummaryLineItem = {
        id: String(entry.id),
        docNo,
        docDate,
        salesPerson,
        taxRatePercent: calculatedTaxPct,
        taxRateName,
        sku: entry.item.sku || entry.item.barCode || 'NO-SKU',
        barCode: entry.item.barCode || entry.item.sku || '-',
        description: entry.item.description || entry.item.sku || 'Article',
        categoryName: catName,
        brandName,
        divisionName,
        genderName,
        silhouetteName,
        sizeName: entry.item.size?.name || 'Default',
        colorName: entry.item.color?.name || 'Default',
        unitPrice,
        soldQty,
        returnQty,
        netQty,
        retailSalesValue,
        wostAmount,
        discountAmount: itemDisc,
        valueExSalesTax,
        taxAmount: taxAmount,
        valueInclSalesTax,
        grossAmount: 0,
        returnAmount: -valueInclSalesTax,
        netAmount: valueInclSalesTax,
      };

      flatItems.push({
        locationId: entry.locationId || undefined,
        locationName: locName,
        cashierUserId: (voucher as any)?.cashierUserId || undefined,
        createdAt: entry.createdAt,
        docNo,
        docDate,
        salesPerson,
        taxRatePercent: calculatedTaxPct,
        taxRateName,
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
        unitPrice,
        soldQty,
        returnQty,
        netQty,
        retailSalesValue,
        wostAmount,
        grossAmount: 0,
        returnAmount: -valueInclSalesTax,
        discountAmount: itemDisc,
        valueExSalesTax,
        taxAmount: taxAmount,
        valueInclSalesTax,
        netAmount: valueInclSalesTax,
      });

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
    body: { fileName: string; fileBase64: string; mimeType: string },
  ) {
    const jobId = uuidv4();
    const fileBuffer = Buffer.from(body.fileBase64, 'base64');
    const tempDir = path.join(process.cwd(), 'uploads', 'exports');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const tempFilePath = path.join(tempDir, `temp-${jobId}-${body.fileName}`);
    fs.writeFileSync(tempFilePath, fileBuffer);

    const activePrisma = prisma || this.prisma;

    await activePrisma.exportHistory.create({
      data: {
        id: jobId,
        userId,
        fileName: body.fileName,
        filePath: path.join('uploads', 'exports', `temp-${jobId}-${body.fileName}`),
        moduleName: 'NET_SALES_SUMMARY_REPORT',
        status: 'PENDING',
      },
    });

    const fileUrl = await this.exportHistoryService.completeAndUploadExport(
      activePrisma,
      jobId,
      tempFilePath,
      body.fileName,
      body.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    return {
      historyId: jobId,
      downloadUrl: fileUrl || `/api/warehouse/export-history/download/${jobId}`,
    };
  }

  async getJobStatus(jobId: string): Promise<{ state: string; progress: number; message?: string }> {
    const job = (await this.exportQueue.getJob(jobId)) || (await this.exportQueue.getJob(`preview-${jobId}`));
    if (!job) throw new NotFoundException(`Export job ${jobId} not found`);
    const state = await job.getState();
    const rawProg: any = job.progress();
    const progress = typeof rawProg === 'number' ? rawProg : typeof rawProg === 'object' && rawProg?.percent !== undefined ? Number(rawProg.percent) : 0;
    const message = typeof rawProg === 'object' && rawProg?.message ? String(rawProg.message) : undefined;
    return { state, progress, message };
  }

  async streamExportFile(jobId: string, res: any): Promise<void> {
    const record = await this.prisma.exportHistory.findUnique({
      where: { id: jobId },
      select: { fileName: true, filePath: true },
    });

    if (!record) {
      throw new NotFoundException(`Export record ${jobId} not found in database`);
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
      const signedUrl = await this.uploadService.getSignedUrlForDownload(s3Key, record.fileName);
      return res.redirect(signedUrl, 302);
    }

    if (record.filePath.startsWith('http://') || record.filePath.startsWith('https://')) {
      return res.redirect(record.filePath, 302);
    }

    const filePath = path.join(process.cwd(), record.filePath);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Export file not found. It may have expired or the job is still running.');
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

  async streamFilteredSummaryPreviewExcel(
    jobId: string,
    options: {
      exportType?: 'flat' | 'hierarchical';
      search?: string;
      locationId?: string;
    },
    res: any,
  ): Promise<void> {
    const result = await this.getReportPreviewResult(jobId);
    if (!result) {
      throw new NotFoundException('Net sales summary preview result not found or expired');
    }

    const exportType = options.exportType || 'flat';
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `net-sales-summary-${exportType}-${dateStr}.xlsx`;

    const passThrough = new PassThrough();
    if (typeof res.header === 'function') {
      res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.header('Content-Disposition', `attachment; filename="${fileName}"`);
      res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (typeof res.setHeader === 'function') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }

    if (typeof res.send === 'function') {
      res.send(passThrough);
    } else if (typeof res.pipe === 'function') {
      passThrough.pipe(res);
    }

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: passThrough,
      useStyles: true,
      useSharedStrings: false,
    });

    const sheet = workbook.addWorksheet(exportType === 'flat' ? 'Net Sales Flat' : 'Net Sales Summary');

    if (exportType === 'flat') {
      sheet.columns = [
        { header: 'Outlet / Location', key: 'locationName', width: 22 },
        { header: 'Month / Year', key: 'monthYear', width: 16 },
        { header: 'Doc Date', key: 'docDate', width: 16 },
        { header: 'Doc Number', key: 'docNo', width: 16 },
        { header: 'Salesperson / Cashier', key: 'salesPerson', width: 20 },
        { header: 'Tax Group Rate', key: 'taxRate', width: 14 },
        { header: 'Brand', key: 'brandName', width: 16 },
        { header: 'Division', key: 'divisionName', width: 16 },
        { header: 'Category', key: 'categoryName', width: 18 },
        { header: 'Gender', key: 'genderName', width: 14 },
        { header: 'Silhouette', key: 'silhouetteName', width: 16 },
        { header: 'SKU', key: 'sku', width: 16 },
        { header: 'Barcode', key: 'barCode', width: 16 },
        { header: 'Description', key: 'description', width: 28 },
        { header: 'Size', key: 'sizeName', width: 10 },
        { header: 'Color', key: 'colorName', width: 12 },
        { header: 'Unit Price', key: 'unitPrice', width: 12 },
        { header: 'Sold Qty', key: 'soldQty', width: 10 },
        { header: 'Return Qty', key: 'returnQty', width: 10 },
        { header: 'Net Qty', key: 'netQty', width: 10 },
        { header: 'Retail Sales Value', key: 'retailSalesValue', width: 16 },
        { header: 'WOST Amount', key: 'wostAmount', width: 14 },
        { header: 'Discount Amount', key: 'discountAmount', width: 14 },
        { header: 'Value Excl. Sales Tax', key: 'valueExSalesTax', width: 16 },
        { header: 'Sales Tax Amount', key: 'taxAmount', width: 14 },
        { header: 'Value Incl. Sales Tax / Net Revenue', key: 'valueInclSalesTax', width: 18 },
      ];

      const q = (options.search || '').trim().toLowerCase();
      const locSet = options.locationId && options.locationId !== 'all'
        ? new Set(options.locationId.split(',').map((s) => s.trim().toLowerCase()))
        : null;

      let totalSold = 0;
      let totalReturn = 0;
      let totalNetQty = 0;
      let totalRetail = 0;
      let totalWost = 0;
      let totalDiscount = 0;
      let totalExTax = 0;
      let totalTax = 0;
      let totalInclTax = 0;

      for (const item of result.flatItems || []) {
        if (locSet) {
          const loc = (item.locationName || '').toLowerCase();
          const locId = (item.locationId || '').toLowerCase();
          if (!locSet.has(loc) && !locSet.has(locId)) continue;
        }

        if (q) {
          const matches =
            (item.sku || '').toLowerCase().includes(q) ||
            (item.barCode || '').toLowerCase().includes(q) ||
            (item.description || '').toLowerCase().includes(q) ||
            (item.categoryName || '').toLowerCase().includes(q) ||
            (item.brandName || '').toLowerCase().includes(q) ||
            (item.docNo || '').toLowerCase().includes(q) ||
            (item.locationName || '').toLowerCase().includes(q);
          if (!matches) continue;
        }

        const sold = Number(item.soldQty || 0);
        const ret = Number(item.returnQty || 0);
        const netQty = Number(item.netQty !== undefined ? item.netQty : (sold - ret));
        const retail = Number(item.retailSalesValue || 0);
        const wost = Number(item.wostAmount || 0);
        const disc = Number(item.discountAmount || 0);
        const exTax = Number(item.valueExSalesTax || 0);
        const tax = Number(item.taxAmount || 0);
        const inclTax = Number(item.valueInclSalesTax || 0);

        totalSold += sold;
        totalReturn += ret;
        totalNetQty += netQty;
        totalRetail += retail;
        totalWost += wost;
        totalDiscount += disc;
        totalExTax += exTax;
        totalTax += tax;
        totalInclTax += inclTax;

        const row = sheet.addRow({
          locationName: item.locationName || '-',
          monthYear: item.docDate ? item.docDate.slice(0, 7) : '-',
          docDate: item.docDate ? item.docDate.slice(0, 10) : '-',
          docNo: item.docNo || '-',
          salesPerson: item.salesPerson || '-',
          taxRate: item.taxRateName || (item.taxRatePercent ? `${item.taxRatePercent}%` : '-'),
          brandName: item.brandName || '-',
          divisionName: item.divisionName || '-',
          categoryName: item.categoryName || '-',
          genderName: item.genderName || '-',
          silhouetteName: item.silhouetteName || '-',
          sku: item.sku || '-',
          barCode: item.barCode || '-',
          description: item.description || '-',
          sizeName: item.sizeName || '-',
          colorName: item.colorName || '-',
          unitPrice: Number(item.unitPrice || 0),
          soldQty: sold,
          returnQty: ret,
          netQty,
          retailSalesValue: retail,
          wostAmount: wost,
          discountAmount: disc,
          valueExSalesTax: exTax,
          taxAmount: tax,
          valueInclSalesTax: inclTax,
        });
        row.commit();
      }

      const summaryRow = sheet.addRow({
        locationName: 'FILTERED TOTALS',
        soldQty: totalSold,
        returnQty: totalReturn,
        netQty: totalNetQty,
        retailSalesValue: totalRetail,
        wostAmount: totalWost,
        discountAmount: totalDiscount,
        valueExSalesTax: totalExTax,
        taxAmount: totalTax,
        valueInclSalesTax: totalInclTax,
      });
      summaryRow.font = { bold: true };
      summaryRow.commit();
    } else {
      // Hierarchy / Category summary
      const hasLocNodes = result.locations && result.locations.length > 0;
      sheet.columns = [
        ...(hasLocNodes ? [{ header: 'Outlet / Location', key: 'locationName', width: 22 }] : []),
        { header: 'Category', key: 'categoryName', width: 22 },
        { header: 'Brand', key: 'brandName', width: 18 },
        { header: 'Division', key: 'divisionName', width: 16 },
        { header: 'Gender', key: 'genderName', width: 14 },
        { header: 'Silhouette', key: 'silhouetteName', width: 16 },
        { header: 'Sold Qty', key: 'soldQty', width: 10 },
        { header: 'Return Qty', key: 'returnQty', width: 10 },
        { header: 'Net Qty', key: 'netQty', width: 10 },
        { header: 'Retail Sales Value', key: 'retailSalesValue', width: 16 },
        { header: 'WOST Amount', key: 'wostAmount', width: 14 },
        { header: 'Discount Amount', key: 'discountAmount', width: 14 },
        { header: 'Value Excl. Sales Tax', key: 'valueExSalesTax', width: 16 },
        { header: 'Sales Tax Amount', key: 'taxAmount', width: 14 },
        { header: 'Value Incl. Sales Tax / Net Revenue', key: 'valueInclSalesTax', width: 18 },
      ];

      if (hasLocNodes) {
        for (const loc of result.locations || []) {
          if (locSet) {
            const lName = (loc.locationName || '').toLowerCase();
            const lId = (loc.locationId || '').toLowerCase();
            if (!locSet.has(lName) && !locSet.has(lId)) continue;
          }
          for (const cat of loc.categories || []) {
            const totals = cat.totals;
            const row = sheet.addRow({
              locationName: loc.locationName,
              categoryName: cat.categoryName || '-',
              brandName: cat.brandName || '-',
              divisionName: cat.divisionName || '-',
              genderName: cat.genderName || '-',
              silhouetteName: cat.silhouetteName || '-',
              soldQty: totals.totalItemsSold,
              returnQty: totals.totalItemsReturned,
              netQty: totals.netItems,
              retailSalesValue: totals.retailSalesValue,
              wostAmount: totals.wostAmount,
              discountAmount: totals.discountAmount,
              valueExSalesTax: totals.valueExSalesTax,
              taxAmount: totals.taxAmount,
              valueInclSalesTax: totals.valueInclSalesTax,
            });
            row.commit();
          }
        }
      } else {
        for (const cat of result.categories || []) {
          const totals = cat.totals;
          const row = sheet.addRow({
            categoryName: cat.categoryName || '-',
            brandName: cat.brandName || '-',
            divisionName: cat.divisionName || '-',
            genderName: cat.genderName || '-',
            silhouetteName: cat.silhouetteName || '-',
            soldQty: totals.totalItemsSold,
            returnQty: totals.totalItemsReturned,
            netQty: totals.netItems,
            retailSalesValue: totals.retailSalesValue,
            wostAmount: totals.wostAmount,
            discountAmount: totals.discountAmount,
            valueExSalesTax: totals.valueExSalesTax,
            taxAmount: totals.taxAmount,
            valueInclSalesTax: totals.valueInclSalesTax,
          });
          row.commit();
        }
      }

      const gt = result.grandTotals;
      const summaryRow = sheet.addRow({
        ...(hasLocNodes ? { locationName: 'GRAND TOTALS' } : {}),
        categoryName: hasLocNodes ? '-' : 'GRAND TOTALS',
        soldQty: gt.totalItemsSold,
        returnQty: gt.totalItemsReturned,
        netQty: gt.netItems,
        retailSalesValue: gt.retailSalesValue,
        wostAmount: gt.wostAmount,
        discountAmount: gt.discountAmount,
        valueExSalesTax: gt.valueExSalesTax,
        taxAmount: gt.taxAmount,
        valueInclSalesTax: gt.valueInclSalesTax,
      });
      summaryRow.font = { bold: true };
      summaryRow.commit();
    }

    sheet.commit();
    await workbook.commit();
  }
}
