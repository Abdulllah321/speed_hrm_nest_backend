import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadService } from '../../upload/upload.service';

export interface QueueStockValuationExportOptions {
  userId: string;
  locationId?: string;
  startDate?: string;
  endDate?: string;
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

@Injectable()
export class StockValuationExportService {
  private readonly logger = new Logger(StockValuationExportService.name);

  constructor(
    @InjectQueue('stock-valuation-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async queueExport(opts: QueueStockValuationExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const ext = opts.format === 'pdf' ? 'pdf' : 'xlsx';

    // Save export job request in history audit table
    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: `stock-valuation-report-${new Date().toISOString().slice(0, 10)}.${ext}`,
        filePath: path.join('uploads', 'exports', `export-${jobId}.${ext}`),
        moduleName: 'STOCK_VALUATION_REPORT',
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
        summaryOnly: !!opts.summaryOnly,
        showBrand: opts.showBrand,
        showDivision: opts.showDivision,
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

    this.logger.log(`[StockValuationExport] Queued job ${jobId} for user ${opts.userId} (format: ${opts.format}, tenant: ${tenantId})`);
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
      throw new NotFoundException(`Export record ${jobId} not found in database`);
    }

    // Increment download count in ExportHistory
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
      this.logger.error(`[StockValuationExport] Stream error: ${err.message}`);
    });

    const isPdf = record.fileName.endsWith('.pdf');
    res.header('Content-Type', isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename="${record.fileName}"`);
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(stream);
  }

  // Get report data in memory for inline UI rendering
  async getValuationReportData(opts: {
    locationId?: string;
    startDate?: string;
    endDate?: string;
    summaryOnly?: boolean;
    showBrand?: boolean;
    showDivision?: boolean;
    showCategory?: boolean;
    showGender?: boolean;
    showSilhouette?: boolean;
    showArticle?: boolean;
    showVariant?: boolean;
  }) {
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

    // Reuse the exact same core logic function that the processor uses
    const { root, grandTotals } = await this.generateValuationReportDataInternal(prisma, opts);
    return { root, grandTotals };
  }

  // Core valuation logic shared between the controller preview and background processor
  async generateValuationReportDataInternal(
    prisma: PrismaService,
    opts: {
      locationId?: string;
      startDate?: string;
      endDate?: string;
      summaryOnly?: boolean;
      showBrand?: boolean;
      showDivision?: boolean;
      showCategory?: boolean;
      showGender?: boolean;
      showSilhouette?: boolean;
      showArticle?: boolean;
      showVariant?: boolean;
    },
  ) {
    const {
      locationId,
      startDate: startStr,
      endDate: endStr,
      summaryOnly,
      showBrand,
      showDivision,
      showCategory,
      showGender,
      showSilhouette,
      showArticle,
      showVariant,
    } = opts;

    const now = new Date();
    const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = endStr ? new Date(endStr) : new Date(now);

    // Discover all distinct items from the StockLedger (location-agnostic when no locationId is provided)
    const ledgerItems = await prisma.stockLedger.findMany({
      where: {
        ...(locationId ? { locationId } : {}),
      },
      select: { itemId: true },
      distinct: ['itemId'],
    });

    const uniqueItemIds = [...new Set(ledgerItems.map(l => l.itemId))];

    if (uniqueItemIds.length === 0) {
      return { root: [], grandTotals: this.createEmptyValuationTotals() };
    }

    const [items, tenantSettings] = await Promise.all([
      prisma.item.findMany({
        where: { id: { in: uniqueItemIds } },
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
      prisma.tenantItemSetting.findMany({
        where: { itemId: { in: uniqueItemIds } },
      }),
    ]);

    const settingMap = new Map(tenantSettings.map(s => [s.itemId, s]));
    const matchedItemIds = items.map(i => i.id);

    // Fetch ALL stock ledger entries for the matched items up to the endDate to compute historical WAC
    const allLedgerEntries = await prisma.stockLedger.findMany({
      where: {
        ...(locationId ? { locationId } : {}),
        itemId: { in: matchedItemIds },
        createdAt: { lte: endDate },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Group ledger entries by itemId for chronological processing
    const ledgerMap = new Map<string, typeof allLedgerEntries>();
    for (const entry of allLedgerEntries) {
      let list = ledgerMap.get(entry.itemId);
      if (!list) {
        list = [];
        ledgerMap.set(entry.itemId, list);
      }
      list.push(entry);
    }

    const itemMetricsMap = new Map<string, ReturnType<typeof this.createEmptyValuationTotals>>();

    for (const item of items) {
      const setting = settingMap.get(item.id);
      const valuationMethod = setting?.valuationMethod || 'WEIGHTED_AVG';
      let defaultCost = Number(
        valuationMethod === 'STANDARD'
          ? (setting?.standardCost || 0)
          : (setting?.averageCost || 0)
      );
      if (defaultCost === 0) {
        defaultCost = Number(item.unitCost || item.fob || 0);
      }

      const entries = ledgerMap.get(item.id) || [];
      
      let qtyBalance = 0;
      let runningWac = defaultCost;

      // Stage totals inside range
      let openingQty = 0;
      let openingWac = defaultCost;
      let periodOpeningQty = 0;
      let periodOpeningVal = 0;

      let purchaseQty = 0;
      let purchaseVal = 0;

      let purchaseRetQty = 0;
      let purchaseRetVal = 0;

      let salesQty = 0;
      let salesVal = 0;

      let adjQty = 0;
      let adjVal = 0;

      for (const entry of entries) {
        const entryQty = Number(entry.qty);
        const entryCost = Number(entry.unitCost ?? entry.rate ?? runningWac);
        const isBeforePeriod = entry.createdAt < startDate;

        if (
          entry.movementType === 'INBOUND' ||
          entry.movementType === 'OPENING_BALANCE' ||
          entry.referenceType === 'OPENING_BALANCE' ||
          entry.referenceType === 'BULK_STOCK_UPLOAD' ||
          (entry.movementType === 'ADJUSTMENT' && entryQty > 0)
        ) {
          // Blended WAC on Inbound / Purchases / Positive Adjustments
          if (valuationMethod === 'WEIGHTED_AVG') {
            const newQty = qtyBalance + entryQty;
            if (newQty > 0) {
              runningWac = ((qtyBalance * runningWac) + (entryQty * entryCost)) / newQty;
            } else {
              runningWac = entryCost;
            }
          }
          qtyBalance += entryQty;

          if (!isBeforePeriod) {
            // Check if it is a purchase vs. adjustment vs. opening
            const ref = entry.referenceType || '';
            const isOpening =
              entry.movementType === 'OPENING_BALANCE' ||
              entry.referenceType === 'OPENING_BALANCE' ||
              entry.referenceType === 'BULK_STOCK_UPLOAD';
            const isPurchase = ref === 'GRN' || ref === 'PURCHASE' || entry.movementType === 'INBOUND';
            const isAdjustment = entry.movementType === 'ADJUSTMENT' || ref === 'ADJUSTMENT' || ref === 'STOCK_ADJUSTMENT';

            if (isOpening) {
              periodOpeningQty += entryQty;
              periodOpeningVal += entryQty * entryCost;
            } else if (isPurchase) {
              purchaseQty += entryQty;
              purchaseVal += entryQty * entryCost;
            } else if (isAdjustment) {
              adjQty += entryQty;
              adjVal += entryQty * entryCost;
            } else {
              // Fallback inbound adjustment
              purchaseQty += entryQty;
              purchaseVal += entryQty * entryCost;
            }
          }
        } else {
          // Outbound (Sales, Negative Adjustments, Purchase Returns, Transfers Out) uses current runningWac
          qtyBalance += entryQty; // entryQty is negative

          if (!isBeforePeriod) {
            const ref = entry.referenceType || '';
            const isPurchaseReturn = ['PURCHASE_RETURN', 'PURCHASE_RETURN_GRN', 'PURCHASE_RETURN_LC'].includes(ref);
            const isSale = ['POS_SALE', 'POS_EXCHANGE_OUT', 'POS_RETURN', 'POS_EXCHANGE_IN', 'POS_REFUND', 'POS_VOID'].includes(ref) || entry.movementType === 'OUTBOUND';
            const isAdjustment = entry.movementType === 'ADJUSTMENT' || ref === 'ADJUSTMENT' || ref === 'STOCK_ADJUSTMENT';

            const absQty = Math.abs(entryQty);

            if (isPurchaseReturn) {
              // Purchase return reduces purchase value at original return cost
              purchaseRetQty += absQty;
              purchaseRetVal += absQty * entryCost;
            } else if (isSale) {
              // Note: for POS Returns, entryQty will be positive, meaning it reduces net sales qty
              if (entryQty > 0) {
                // Return
                salesQty -= entryQty;
                salesVal -= entryQty * entryCost;
              } else {
                // Sale (outbound)
                salesQty += absQty;
                salesVal += absQty * runningWac; // COGS
              }
            } else if (isAdjustment) {
              adjQty += entryQty; // negative
              adjVal += entryQty * runningWac; // negative value
            } else {
              // Default sales/outbound
              salesQty += absQty;
              salesVal += absQty * runningWac;
            }
          }
        }

        // Capture WAC just before period starts
        if (isBeforePeriod) {
          openingQty = qtyBalance;
          openingWac = runningWac;
        }
      }

      // Calculations of final stage values
      const openingValue = (openingQty * openingWac) + periodOpeningVal;
      const finalOpeningQty = openingQty + periodOpeningQty;
      const finalOpeningWac = finalOpeningQty > 0 ? openingValue / finalOpeningQty : defaultCost;
      
      const purchaseCost = purchaseQty > 0 ? purchaseVal / purchaseQty : 0;
      const purchaseRetCost = purchaseRetQty > 0 ? purchaseRetVal / purchaseRetQty : 0;

      const availableQty = finalOpeningQty + purchaseQty - purchaseRetQty;
      const availableVal = openingValue + purchaseVal - purchaseRetVal;
      const availableCost = availableQty > 0 ? availableVal / availableQty : 0;

      const salesCost = salesQty > 0 ? salesVal / salesQty : 0;

      const adjCost = adjQty !== 0 ? adjVal / adjQty : 0;

      const closingQty = availableQty - salesQty + adjQty;
      const closingVal = availableVal - salesVal + adjVal;
      const closingCost = closingQty > 0 ? closingVal / closingQty : 0;

      itemMetricsMap.set(item.id, {
        openingQty: finalOpeningQty,
        openingCost: finalOpeningWac,
        openingValue,
        purchaseQty,
        purchaseCost,
        purchaseValue: purchaseVal,
        purchaseRetQty,
        purchaseRetCost,
        purchaseRetValue: purchaseRetVal,
        availableQty,
        availableCost,
        availableValue: availableVal,
        salesQty,
        salesCost,
        salesValue: salesVal,
        adjQty,
        adjCost,
        adjValue: adjVal,
        closingQty,
        closingCost,
        closingValue: closingVal,
      });
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

    const addValuationTotals = (target: any, source: any) => {
      target.openingQty += source.openingQty;
      target.openingValue += source.openingValue;
      target.openingCost = target.openingQty > 0 ? target.openingValue / target.openingQty : 0;

      target.purchaseQty += source.purchaseQty;
      target.purchaseValue += source.purchaseValue;
      target.purchaseCost = target.purchaseQty > 0 ? target.purchaseValue / target.purchaseQty : 0;

      target.purchaseRetQty += source.purchaseRetQty;
      target.purchaseRetValue += source.purchaseRetValue;
      target.purchaseRetCost = target.purchaseRetQty > 0 ? target.purchaseRetValue / target.purchaseRetQty : 0;

      target.availableQty += source.availableQty;
      target.availableValue += source.availableValue;
      target.availableCost = target.availableQty > 0 ? target.availableValue / target.availableQty : 0;

      target.salesQty += source.salesQty;
      target.salesValue += source.salesValue;
      target.salesCost = target.salesQty > 0 ? target.salesValue / target.salesQty : 0;

      target.adjQty += source.adjQty;
      target.adjValue += source.adjValue;
      target.adjCost = target.adjQty !== 0 ? target.adjValue / target.adjQty : 0;

      target.closingQty += source.closingQty;
      target.closingValue += source.closingValue;
      target.closingCost = target.closingQty > 0 ? target.closingValue / target.closingQty : 0;
    };

    for (const item of items) {
      const metrics = itemMetricsMap.get(item.id) || this.createEmptyValuationTotals();

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
            totals: this.createEmptyValuationTotals(),
            ...extraFields,
            children: [],
          };
          currentLevelNodes.push(existingNode);
        }

        addValuationTotals(existingNode.totals, metrics);

        if (i < levels.length - 1) {
          currentLevelNodes = existingNode.children;
        }
      }
    }

    // Compute grand totals
    const grandTotals = this.createEmptyValuationTotals();
    for (const node of root) {
      addValuationTotals(grandTotals, node.totals);
    }

    return { root, grandTotals };
  }

  private createEmptyValuationTotals() {
    return {
      openingQty: 0,
      openingCost: 0,
      openingValue: 0,
      purchaseQty: 0,
      purchaseCost: 0,
      purchaseValue: 0,
      purchaseRetQty: 0,
      purchaseRetCost: 0,
      purchaseRetValue: 0,
      availableQty: 0,
      availableCost: 0,
      availableValue: 0,
      salesQty: 0,
      salesCost: 0,
      salesValue: 0,
      adjQty: 0,
      adjCost: 0,
      adjValue: 0,
      closingQty: 0,
      closingCost: 0,
      closingValue: 0,
    };
  }
}
