import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../database/prisma.service';
import { UploadService } from '../../upload/upload.service';

export interface QueuePoRegisterExportOptions {
  userId: string;
  brandId?: string;
  vendorId?: string;
  startDate?: string;
  endDate?: string;
  orderType?: string;
  goodsType?: string;
  status?: string;
  format: 'xlsx' | 'pdf';
  search?: string;
}

export interface PoRegisterGrnInfo {
  grnNumber: string;
  status: string;
  receivedDate: string;
}

export interface PoRegisterVariantRow {
  color: string;
  size: string;
  barCode: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface PoRegisterArticleGroup {
  sku: string;
  description: string;
  variants: PoRegisterVariantRow[];
  totalQuantity: number;
  totalAmount: number;
}

export interface PoRegisterSilhouetteGroup {
  silhouetteName: string;
  articles: PoRegisterArticleGroup[];
  totalQuantity: number;
  totalAmount: number;
}

export interface PoRegisterGenderGroup {
  genderName: string;
  silhouettes: PoRegisterSilhouetteGroup[];
  totalQuantity: number;
  totalAmount: number;
}

export interface PoRegisterCategoryGroup {
  categoryName: string;
  subCategoryName: string;
  genders: PoRegisterGenderGroup[];
  totalQuantity: number;
  totalAmount: number;
}

export interface PoRegisterDivisionGroup {
  divisionName: string;
  categories: PoRegisterCategoryGroup[];
  totalQuantity: number;
  totalAmount: number;
}

export interface PoRegisterDocumentGroup {
  poId: string;
  poNumber: string;
  orderDate: string;
  supplierName: string;
  supplierLocation: string;
  brandsDisplay: string;
  orderType?: string;
  goodsType?: string;
  status: string;
  grns: PoRegisterGrnInfo[];
  divisions: PoRegisterDivisionGroup[];
  totalQuantity: number;
  totalAmount: number;
}

export interface PoRegisterReportResult {
  documents: PoRegisterDocumentGroup[];
  grandTotals: {
    quantity: number;
    amount: number;
    totalDocuments: number;
  };
  startDate: string;
  endDate: string;
  appliedFilters: {
    brandId?: string;
    vendorId?: string;
    orderType?: string;
    goodsType?: string;
    status?: string;
    search?: string;
  };
}

@Injectable()
export class PoRegisterExportService {
  private readonly logger = new Logger(PoRegisterExportService.name);

  constructor(
    @InjectQueue('po-register-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async getReportData(params: {
    brandId?: string;
    vendorId?: string;
    startDate?: string;
    endDate?: string;
    orderType?: string;
    goodsType?: string;
    status?: string;
    search?: string;
  }): Promise<PoRegisterReportResult> {
    const {
      brandId,
      vendorId,
      startDate: startStr,
      endDate: endStr,
      orderType,
      goodsType,
      status,
      search,
    } = params;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed; July = 6
    const fyStartYear = currentMonth >= 6 ? currentYear : currentYear - 1;

    // Default start date is July 1st of current Financial Year
    const startDate = startStr
      ? new Date(startStr)
      : new Date(fyStartYear, 6, 1, 0, 0, 0, 0);

    const endDate = endStr
      ? new Date(endStr)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const where: any = {
      orderDate: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (vendorId) where.vendorId = vendorId;
    if (orderType && orderType !== 'ALL') where.orderType = orderType;
    if (goodsType && goodsType !== 'ALL') where.goodsType = goodsType;
    if (status && status !== 'ALL') where.status = status;

    if (brandId) {
      where.items = {
        some: {
          item: {
            brandId: brandId,
          },
        },
      };
    }

    if (search) {
      where.OR = [
        { poNumber: { contains: search, mode: 'insensitive' } },
        { vendor: { name: { contains: search, mode: 'insensitive' } } },
        {
          items: {
            some: {
              OR: [
                { description: { contains: search, mode: 'insensitive' } },
                { item: { sku: { contains: search, mode: 'insensitive' } } },
                { item: { description: { contains: search, mode: 'insensitive' } } },
                { item: { barCode: { contains: search, mode: 'insensitive' } } },
              ],
            },
          },
        },
      ];
    }

    const purchaseOrders = await this.prisma.purchaseOrder.findMany({
      where,
      include: {
        vendor: true,
        goodsReceiptNotes: {
          select: {
            id: true,
            grnNumber: true,
            status: true,
            receivedDate: true,
          },
        },
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
      orderBy: { orderDate: 'desc' },
    });

    const documents: PoRegisterDocumentGroup[] = [];

    for (const po of purchaseOrders) {
      const supplierName = po.vendor?.name || 'Unknown Supplier';
      const supplierLocation =
        po.vendor?.city || po.vendor?.address || po.vendor?.code || 'Location N/A';
      const poDateStr = po.orderDate ? new Date(po.orderDate).toISOString().slice(0, 10) : '';

      const grns: PoRegisterGrnInfo[] = (po.goodsReceiptNotes || []).map((g: any) => ({
        grnNumber: g.grnNumber,
        status: g.status,
        receivedDate: g.receivedDate ? new Date(g.receivedDate).toISOString().slice(0, 10) : '',
      }));

      // Collect distinct brands for this PO document
      const brandNamesSet = new Set<string>();
      for (const itemRow of po.items) {
        if (itemRow.item?.brand?.name) {
          brandNamesSet.add(itemRow.item.brand.name.toUpperCase());
        }
      }
      const brandsDisplay =
        brandNamesSet.size > 0 ? Array.from(brandNamesSet).join(' | ') : 'UNASSIGNED BRAND';

      const docGroup: PoRegisterDocumentGroup = {
        poId: po.id,
        poNumber: po.poNumber,
        orderDate: poDateStr,
        supplierName,
        supplierLocation,
        brandsDisplay,
        orderType: po.orderType || undefined,
        goodsType: po.goodsType || undefined,
        status: po.status,
        grns,
        divisions: [],
        totalQuantity: 0,
        totalAmount: 0,
      };

      for (const itemRow of po.items) {
        const itemObj = itemRow.item;
        const divName = (itemObj?.division?.name || 'GENERAL').toUpperCase();
        const catName = (itemObj?.category?.name || 'GENERAL').toUpperCase();
        const subCatName = (itemObj?.subCategory?.name || 'GENERAL').toUpperCase();
        const genderName = (itemObj?.gender?.name || 'UNASSIGNED').toUpperCase();
        const silName = (itemObj?.silhouette?.name || 'GENERAL').toUpperCase();

        const sku = itemObj?.sku || itemObj?.itemId || 'N/A';
        const description = itemObj?.description || itemRow.description || 'N/A';
        const barCode = itemObj?.barCode || 'N/A';
        const colorName = (itemObj?.color?.name || 'N/A').toUpperCase();
        const sizeName = (itemObj?.size?.name || 'N/A').toUpperCase();

        const qty = Number(itemRow.quantity) || 0;
        const unitPrice = Number(itemRow.unitPrice) || 0;
        const lineTotal = Number(itemRow.lineTotal) || qty * unitPrice;

        // Division Level
        let divGroup = docGroup.divisions.find((d) => d.divisionName === divName);
        if (!divGroup) {
          divGroup = {
            divisionName: divName,
            categories: [],
            totalQuantity: 0,
            totalAmount: 0,
          };
          docGroup.divisions.push(divGroup);
        }

        // Category Level
        let catGroup = divGroup.categories.find((c) => c.categoryName === catName);
        if (!catGroup) {
          catGroup = {
            categoryName: catName,
            subCategoryName: subCatName,
            genders: [],
            totalQuantity: 0,
            totalAmount: 0,
          };
          divGroup.categories.push(catGroup);
        }

        // Gender Level
        let genGroup = catGroup.genders.find((g) => g.genderName === genderName);
        if (!genGroup) {
          genGroup = {
            genderName,
            silhouettes: [],
            totalQuantity: 0,
            totalAmount: 0,
          };
          catGroup.genders.push(genGroup);
        }

        // Silhouette Level
        let silGroup = genGroup.silhouettes.find((s) => s.silhouetteName === silName);
        if (!silGroup) {
          silGroup = {
            silhouetteName: silName,
            articles: [],
            totalQuantity: 0,
            totalAmount: 0,
          };
          genGroup.silhouettes.push(silGroup);
        }

        // Article Level (Grouped by SKU & Description)
        let artGroup = silGroup.articles.find((a) => a.sku === sku);
        if (!artGroup) {
          artGroup = {
            sku,
            description: description.toUpperCase(),
            variants: [],
            totalQuantity: 0,
            totalAmount: 0,
          };
          silGroup.articles.push(artGroup);
        }

        // Variant Detail Level
        artGroup.variants.push({
          color: colorName,
          size: sizeName,
          barCode,
          quantity: qty,
          unitPrice,
          lineTotal,
        });

        artGroup.totalQuantity += qty;
        artGroup.totalAmount += lineTotal;

        silGroup.totalQuantity += qty;
        silGroup.totalAmount += lineTotal;

        genGroup.totalQuantity += qty;
        genGroup.totalAmount += lineTotal;

        catGroup.totalQuantity += qty;
        catGroup.totalAmount += lineTotal;

        divGroup.totalQuantity += qty;
        divGroup.totalAmount += lineTotal;

        docGroup.totalQuantity += qty;
        docGroup.totalAmount += lineTotal;
      }

      if (docGroup.divisions.length > 0) {
        documents.push(docGroup);
      }
    }

    const grandTotals = documents.reduce(
      (acc, d) => {
        acc.quantity += d.totalQuantity;
        acc.amount += d.totalAmount;
        acc.totalDocuments += 1;
        return acc;
      },
      { quantity: 0, amount: 0, totalDocuments: 0 },
    );

    return {
      documents,
      grandTotals,
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
      appliedFilters: {
        brandId,
        vendorId,
        orderType,
        goodsType,
        status,
        search,
      },
    };
  }

  async queueExport(opts: QueuePoRegisterExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const ext = opts.format === 'pdf' ? 'pdf' : 'xlsx';

    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: `po-register-${new Date().toISOString().slice(0, 10)}.${ext}`,
        filePath: path.join('uploads', 'exports', `export-${jobId}.${ext}`),
        moduleName: 'PO_REGISTER_EXPORT',
        status: 'PENDING',
      },
    });

    await this.exportQueue.add(
      {
        jobId,
        userId: opts.userId,
        tenantId,
        tenantDbUrl,
        brandId: opts.brandId,
        vendorId: opts.vendorId,
        startDate: opts.startDate,
        endDate: opts.endDate,
        orderType: opts.orderType,
        goodsType: opts.goodsType,
        status: opts.status,
        format: opts.format,
        search: opts.search,
      },
      {
        jobId,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
        timeout: 2 * 60 * 60 * 1000,
      },
    );

    this.logger.log(`[PoRegisterExport] Queued job ${jobId} for user ${opts.userId} (format: ${opts.format})`);
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
