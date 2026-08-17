import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../database/prisma.service';
import { UploadService } from '../../upload/upload.service';

export interface QueuePiRegisterExportOptions {
  userId: string;
  brandId?: string;
  supplierId?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  paymentStatus?: string;
  invoiceType?: string;
  format: 'xlsx' | 'pdf';
  exportType?: 'hierarchical' | 'flat';
  search?: string;
}

export interface PiRegisterVariantRow {
  color: string;
  size: string;
  barCode: string;
  quantity: number;
  unitCost: number;
  valExclTax: number;
  salesTax: number;
  valInclTax: number;
  advTax: number;
  lineTotal: number;
}

export interface PiRegisterArticleGroup {
  sku: string;
  description: string;
  variants: PiRegisterVariantRow[];
  totalQuantity: number;
  totalValExclTax: number;
  totalSalesTax: number;
  totalValInclTax: number;
  totalAdvTax: number;
  totalLineTotal: number;
}

export interface PiRegisterSilhouetteGroup {
  silhouetteName: string;
  articles: PiRegisterArticleGroup[];
  totalQuantity: number;
  totalValExclTax: number;
  totalSalesTax: number;
  totalValInclTax: number;
  totalAdvTax: number;
  totalLineTotal: number;
}

export interface PiRegisterGenderGroup {
  genderName: string;
  silhouettes: PiRegisterSilhouetteGroup[];
  totalQuantity: number;
  totalValExclTax: number;
  totalSalesTax: number;
  totalValInclTax: number;
  totalAdvTax: number;
  totalLineTotal: number;
}

export interface PiRegisterCategoryGroup {
  categoryName: string;
  subCategoryName: string;
  genders: PiRegisterGenderGroup[];
  totalQuantity: number;
  totalValExclTax: number;
  totalSalesTax: number;
  totalValInclTax: number;
  totalAdvTax: number;
  totalLineTotal: number;
}

export interface PiRegisterDivisionGroup {
  divisionName: string;
  categories: PiRegisterCategoryGroup[];
  totalQuantity: number;
  totalValExclTax: number;
  totalSalesTax: number;
  totalValInclTax: number;
  totalAdvTax: number;
  totalLineTotal: number;
}

export interface PiRegisterDocumentGroup {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  supplierName: string;
  supplierLocation: string;
  brandsDisplay: string;
  grnNumber?: string;
  status: string;
  paymentStatus: string;
  invoiceType: string;
  advanceTaxRate: number;
  divisions: PiRegisterDivisionGroup[];
  totalQuantity: number;
  totalValExclTax: number;
  totalSalesTax: number;
  totalValInclTax: number;
  totalAdvTax: number;
  totalLineTotal: number;
}

export interface PiRegisterReportResult {
  documents: PiRegisterDocumentGroup[];
  grandTotals: {
    quantity: number;
    valExclTax: number;
    salesTax: number;
    valInclTax: number;
    advTax: number;
    lineTotal: number;
    totalDocuments: number;
  };
  startDate: string;
  endDate: string;
  appliedFilters: {
    brandId?: string;
    supplierId?: string;
    status?: string;
    paymentStatus?: string;
    invoiceType?: string;
    search?: string;
  };
}

@Injectable()
export class PiRegisterExportService {
  private readonly logger = new Logger(PiRegisterExportService.name);

  constructor(
    @InjectQueue('pi-register-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async getReportData(
    params: {
      brandId?: string;
      supplierId?: string;
      startDate?: string;
      endDate?: string;
      status?: string;
      paymentStatus?: string;
      invoiceType?: string;
      search?: string;
    },
    prismaParam?: PrismaService,
  ): Promise<PiRegisterReportResult> {
    const prisma = prismaParam || this.prisma;
    const {
      brandId,
      supplierId,
      startDate: startStr,
      endDate: endStr,
      status,
      paymentStatus,
      invoiceType,
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
      invoiceDate: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (supplierId) where.supplierId = supplierId;
    if (status && status !== 'ALL') where.status = status;
    if (paymentStatus && paymentStatus !== 'ALL') where.paymentStatus = paymentStatus;
    if (invoiceType && invoiceType !== 'ALL') where.invoiceType = invoiceType;

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
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { supplier: { name: { contains: search, mode: 'insensitive' } } },
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

    const invoices = await prisma.purchaseInvoice.findMany({
      where,
      include: {
        supplier: true,
        grn: {
          select: {
            grnNumber: true,
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
      orderBy: { invoiceDate: 'desc' },
    });

    const documents: PiRegisterDocumentGroup[] = [];

    for (const inv of invoices) {
      const supplierName = inv.supplier?.name || 'Unknown Supplier';
      const supplierLocation =
        inv.supplier?.city || inv.supplier?.address || inv.supplier?.code || 'Location N/A';
      const invDateStr = inv.invoiceDate ? new Date(inv.invoiceDate).toISOString().slice(0, 10) : '';
      const advRate = Number(inv.advanceTaxRate || 0.5);

      // Collect distinct brands for this PI document
      const brandNamesSet = new Set<string>();
      for (const itemRow of inv.items) {
        if (itemRow.item?.brand?.name) {
          brandNamesSet.add(itemRow.item.brand.name.toUpperCase());
        }
      }
      const brandsDisplay =
        brandNamesSet.size > 0 ? Array.from(brandNamesSet).join(' | ') : 'UNASSIGNED BRAND';

      const docGroup: PiRegisterDocumentGroup = {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: invDateStr,
        supplierName,
        supplierLocation,
        brandsDisplay,
        grnNumber: inv.grn?.grnNumber || undefined,
        status: inv.status,
        paymentStatus: inv.paymentStatus,
        invoiceType: inv.invoiceType,
        advanceTaxRate: advRate,
        divisions: [],
        totalQuantity: 0,
        totalValExclTax: 0,
        totalSalesTax: 0,
        totalValInclTax: 0,
        totalAdvTax: 0,
        totalLineTotal: 0,
      };

      for (const itemRow of inv.items) {
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
        const unitCost = Number(itemRow.unitPrice) || 0;
        const discRate = Number(itemRow.discountRate) || 0;
        const discAmt = Number(itemRow.discountAmount) || (qty * unitCost * discRate) / 100;
        const valExclTax = qty * unitCost - discAmt;
        const taxRate = Number(itemRow.taxRate) || 0;
        const salesTax = Number(itemRow.taxAmount) || (valExclTax * taxRate) / 100;
        const valInclTax = valExclTax + salesTax;
        const advTax = (valInclTax * advRate) / 100;
        const lineTotal = Number(itemRow.lineTotal) || valInclTax + advTax;

        // Division Level
        let divGroup = docGroup.divisions.find((d) => d.divisionName === divName);
        if (!divGroup) {
          divGroup = {
            divisionName: divName,
            categories: [],
            totalQuantity: 0,
            totalValExclTax: 0,
            totalSalesTax: 0,
            totalValInclTax: 0,
            totalAdvTax: 0,
            totalLineTotal: 0,
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
            totalValExclTax: 0,
            totalSalesTax: 0,
            totalValInclTax: 0,
            totalAdvTax: 0,
            totalLineTotal: 0,
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
            totalValExclTax: 0,
            totalSalesTax: 0,
            totalValInclTax: 0,
            totalAdvTax: 0,
            totalLineTotal: 0,
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
            totalValExclTax: 0,
            totalSalesTax: 0,
            totalValInclTax: 0,
            totalAdvTax: 0,
            totalLineTotal: 0,
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
            totalValExclTax: 0,
            totalSalesTax: 0,
            totalValInclTax: 0,
            totalAdvTax: 0,
            totalLineTotal: 0,
          };
          silGroup.articles.push(artGroup);
        }

        // Variant Detail Level
        artGroup.variants.push({
          color: colorName,
          size: sizeName,
          barCode,
          quantity: qty,
          unitCost,
          valExclTax,
          salesTax,
          valInclTax,
          advTax,
          lineTotal,
        });

        // Add to Article totals
        artGroup.totalQuantity += qty;
        artGroup.totalValExclTax += valExclTax;
        artGroup.totalSalesTax += salesTax;
        artGroup.totalValInclTax += valInclTax;
        artGroup.totalAdvTax += advTax;
        artGroup.totalLineTotal += lineTotal;

        // Add to Silhouette totals
        silGroup.totalQuantity += qty;
        silGroup.totalValExclTax += valExclTax;
        silGroup.totalSalesTax += salesTax;
        silGroup.totalValInclTax += valInclTax;
        silGroup.totalAdvTax += advTax;
        silGroup.totalLineTotal += lineTotal;

        // Add to Gender totals
        genGroup.totalQuantity += qty;
        genGroup.totalValExclTax += valExclTax;
        genGroup.totalSalesTax += salesTax;
        genGroup.totalValInclTax += valInclTax;
        genGroup.totalAdvTax += advTax;
        genGroup.totalLineTotal += lineTotal;

        // Add to Category totals
        catGroup.totalQuantity += qty;
        catGroup.totalValExclTax += valExclTax;
        catGroup.totalSalesTax += salesTax;
        catGroup.totalValInclTax += valInclTax;
        catGroup.totalAdvTax += advTax;
        catGroup.totalLineTotal += lineTotal;

        // Add to Division totals
        divGroup.totalQuantity += qty;
        divGroup.totalValExclTax += valExclTax;
        divGroup.totalSalesTax += salesTax;
        divGroup.totalValInclTax += valInclTax;
        divGroup.totalAdvTax += advTax;
        divGroup.totalLineTotal += lineTotal;

        // Add to Document totals
        docGroup.totalQuantity += qty;
        docGroup.totalValExclTax += valExclTax;
        docGroup.totalSalesTax += salesTax;
        docGroup.totalValInclTax += valInclTax;
        docGroup.totalAdvTax += advTax;
        docGroup.totalLineTotal += lineTotal;
      }

      if (docGroup.divisions.length > 0) {
        documents.push(docGroup);
      }
    }

    const grandTotals = documents.reduce(
      (acc, d) => {
        acc.quantity += d.totalQuantity;
        acc.valExclTax += d.totalValExclTax;
        acc.salesTax += d.totalSalesTax;
        acc.valInclTax += d.totalValInclTax;
        acc.advTax += d.totalAdvTax;
        acc.lineTotal += d.totalLineTotal;
        acc.totalDocuments += 1;
        return acc;
      },
      {
        quantity: 0,
        valExclTax: 0,
        salesTax: 0,
        valInclTax: 0,
        advTax: 0,
        lineTotal: 0,
        totalDocuments: 0,
      },
    );

    return {
      documents,
      grandTotals,
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
      appliedFilters: {
        brandId,
        supplierId,
        status,
        paymentStatus,
        invoiceType,
        search,
      },
    };
  }

  async queueExport(opts: QueuePiRegisterExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const ext = opts.format === 'pdf' ? 'pdf' : 'xlsx';

    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: `pi-register-${new Date().toISOString().slice(0, 10)}.${ext}`,
        filePath: path.join('uploads', 'exports', `export-${jobId}.${ext}`),
        moduleName: 'PI_REGISTER_EXPORT',
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
        supplierId: opts.supplierId,
        startDate: opts.startDate,
        endDate: opts.endDate,
        status: opts.status,
        paymentStatus: opts.paymentStatus,
        invoiceType: opts.invoiceType,
        format: opts.format,
        exportType: opts.exportType,
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

    this.logger.log(`[PiRegisterExport] Queued job ${jobId} for user ${opts.userId} (format: ${opts.format})`);
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
