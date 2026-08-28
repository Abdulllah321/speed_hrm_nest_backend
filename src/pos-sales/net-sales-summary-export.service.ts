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
    private readonly prismaMaster: PrismaMasterService,
    private readonly uploadService: UploadService,
    private readonly exportHistoryService: ExportHistoryService,
  ) {}

  async queueExport(
    prisma: PrismaService,
    options: QueueNetSalesSummaryExportOptions,
  ): Promise<{ jobId: string; historyId: string }> {
    const { userId, locationId, startDate, endDate, format } = options;
    const dateStr = new Date().toISOString().split('T')[0];
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    const fileName = `net-sales-summary-report-${dateStr}.${ext}`;

    const tenantInfo = await this.prismaMaster.getCurrentTenantInfo(userId);
    const jobId = uuidv4();

    await this.exportHistoryService.registerPendingExport(prisma, {
      jobId,
      userId,
      fileName,
      moduleName: 'NET_SALES_SUMMARY_REPORT',
    });

    await this.exportQueue.add(
      {
        jobId,
        userId,
        tenantId: tenantInfo.tenantId,
        tenantDbUrl: tenantInfo.dbUrl,
        ...options,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    return { jobId, historyId: jobId };
  }

  async queueReportPreview(
    prisma: PrismaService,
    options: {
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
    },
  ): Promise<{ jobId: string }> {
    const { userId } = options;
    const tenantInfo = await this.prismaMaster.getCurrentTenantInfo(userId);
    const jobId = uuidv4();

    await this.exportQueue.add(
      'generate-net-sales-summary-preview',
      {
        jobId,
        userId,
        tenantId: tenantInfo.tenantId,
        tenantDbUrl: tenantInfo.dbUrl,
        ...options,
      },
      {
        attempts: 2,
        backoff: { type: 'fixed', delay: 3000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    return { jobId };
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

    const rawOrders = await prisma.salesOrder.findMany({
      where,
      include: {
        cashierUser: {
          select: { firstName: true, lastName: true, email: true },
        },
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

    for (const order of rawOrders) {
      const isReturnOrder = Boolean(
        order.returnNumber ||
        order.refundNumber ||
        order.status === 'refunded' ||
        order.status === 'returned',
      );
      const locName = order.locationId ? locationMap.get(order.locationId) || 'Main Outlet' : 'Main Outlet';
      const locKey = order.locationId ? `loc:${order.locationId}` : 'main-outlet';

      const docNo = order.orderNumber || order.returnNumber || 'N/A';
      const docDate = order.createdAt ? new Date(order.createdAt).toISOString().split('T')[0] : 'N/A';

      let salesPerson = 'Default Cashier';
      if ((order as any).cashierUser) {
        const u = (order as any).cashierUser;
        salesPerson = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Cashier';
      } else if (order.notes) {
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
        const taxPercent = Number((item as any).taxPercent || 0);

        const soldQty = isReturnOrder ? 0 : qty;
        const returnQty = isReturnOrder ? qty : 0;
        const netQty = soldQty - returnQty;

        const grossAmt = isReturnOrder ? 0 : unitPrice * soldQty;
        const retAmt = isReturnOrder ? lineTotal : 0;
        const retailSalesValue = unitPrice * netQty;
        const wostAmount = grossAmt - retAmt;
        const valueExSalesTax = wostAmount - disc;
        const valueInclSalesTax = isReturnOrder ? -lineTotal : (valueExSalesTax + tax);

        const calculatedTaxPct = taxPercent > 0
          ? taxPercent
          : (valueExSalesTax > 0 ? Math.round((tax / valueExSalesTax) * 100) : (tax > 0 ? 18 : 0));
        const taxRateName = calculatedTaxPct > 0 ? `${calculatedTaxPct}% Sales Tax Group` : '0% Tax Exempt Group';

        const lineTotals: NetSalesSummaryTotals = {
          orderCount: 1,
          unitPrice,
          totalItemsSold: soldQty,
          totalItemsReturned: returnQty,
          netItems: netQty,
          retailSalesValue,
          wostAmount,
          discountAmount: disc,
          valueExSalesTax,
          taxAmount: tax,
          valueInclSalesTax,
          grossSalesAmount: grossAmt,
          returnAmount: retAmt,
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
          discountAmount: disc,
          valueExSalesTax,
          taxAmount: tax,
          valueInclSalesTax,
          grossAmount: grossAmt,
          returnAmount: retAmt,
          netAmount: valueInclSalesTax,
        };

        flatItems.push({
          locationName: locName,
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
    opts: {
      userId: string;
      exportType: 'flat' | 'hierarchical';
      format: 'xlsx' | 'pdf';
      fileBuffer: Buffer;
      fileName: string;
    },
  ): Promise<{ historyId: string; downloadUrl: string }> {
    const { userId, format, fileBuffer, fileName } = opts;
    const jobId = uuidv4();
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';

    await this.exportHistoryService.registerPendingExport(prisma, {
      jobId,
      userId,
      fileName,
      moduleName: 'NET_SALES_SUMMARY_REPORT',
    });

    const mimeType =
      format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    const tempDir = path.join(process.cwd(), 'uploads', 'exports');
    await fs.promises.mkdir(tempDir, { recursive: true });
    const tempFilePath = path.join(tempDir, `temp-${jobId}.${ext}`);
    await fs.promises.writeFile(tempFilePath, fileBuffer);

    const historyRecord = await this.exportHistoryService.completeAndUploadExport(
      prisma,
      jobId,
      tempFilePath,
      fileName,
      mimeType,
    );

    return {
      historyId: historyRecord.id,
      downloadUrl: historyRecord.fileUrl || `/api/warehouse/export-history/download/${jobId}`,
    };
  }
}
