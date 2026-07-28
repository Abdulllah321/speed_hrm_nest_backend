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
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface PoRegisterProductGroup {
  articleCode: string;
  articleName: string;
  divisionName: string;
  genderName: string;
  silhouetteName: string;
  variants: PoRegisterVariantRow[];
  totalQuantity: number;
  totalAmount: number;
}

export interface PoRegisterSubcategoryGroup {
  subCategoryName: string;
  products: PoRegisterProductGroup[];
  totalQuantity: number;
  totalAmount: number;
}

export interface PoRegisterCategoryGroup {
  categoryName: string;
  subcategories: PoRegisterSubcategoryGroup[];
  totalQuantity: number;
  totalAmount: number;
}

export interface PoRegisterDocumentGroup {
  poId: string;
  poNumber: string;
  docNoDisplay: string;
  orderDate: string;
  supplierName: string;
  supplierLocation: string;
  orderType?: string;
  goodsType?: string;
  status: string;
  grns: PoRegisterGrnInfo[];
  categories: PoRegisterCategoryGroup[];
  totalQuantity: number;
  totalAmount: number;
}

export interface PoRegisterBrandGroup {
  brandId: string;
  brandName: string;
  documents: PoRegisterDocumentGroup[];
  totalQuantity: number;
  totalAmount: number;
}

export interface PoRegisterReportResult {
  brands: PoRegisterBrandGroup[];
  grandTotals: {
    quantity: number;
    amount: number;
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
                { item: { itemId: { contains: search, mode: 'insensitive' } } },
                { item: { description: { contains: search, mode: 'insensitive' } } },
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

    const brandMap = new Map<string, PoRegisterBrandGroup>();

    let docIndexCounter = 1;

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

      for (const itemRow of po.items) {
        const itemObj = itemRow.item;
        const brandObj = itemObj?.brand;
        const bId = brandObj?.id || 'unassigned';
        const bName = (brandObj?.name || 'UNASSIGNED BRAND').toUpperCase();

        if (!brandMap.has(bId)) {
          brandMap.set(bId, {
            brandId: bId,
            brandName: bName,
            documents: [],
            totalQuantity: 0,
            totalAmount: 0,
          });
        }
        const brandGroup = brandMap.get(bId)!;

        let docGroup = brandGroup.documents.find((d) => d.poId === po.id);
        if (!docGroup) {
          docGroup = {
            poId: po.id,
            poNumber: po.poNumber,
            docNoDisplay: String(docIndexCounter++),
            orderDate: poDateStr,
            supplierName,
            supplierLocation,
            orderType: po.orderType || undefined,
            goodsType: po.goodsType || undefined,
            status: po.status,
            grns,
            categories: [],
            totalQuantity: 0,
            totalAmount: 0,
          };
          brandGroup.documents.push(docGroup);
        }

        const catName = (itemObj?.category?.name || 'GENERAL').toUpperCase();

        let catGroup = docGroup.categories.find((c) => c.categoryName === catName);
        if (!catGroup) {
          catGroup = {
            categoryName: catName,
            subcategories: [],
            totalQuantity: 0,
            totalAmount: 0,
          };
          docGroup.categories.push(catGroup);
        }

        const subCatName = (itemObj?.subCategory?.name || 'GENERAL').toUpperCase();

        let subCatGroup = catGroup.subcategories.find((sc) => sc.subCategoryName === subCatName);
        if (!subCatGroup) {
          subCatGroup = {
            subCategoryName: subCatName,
            products: [],
            totalQuantity: 0,
            totalAmount: 0,
          };
          catGroup.subcategories.push(subCatGroup);
        }

        const articleCode = itemObj?.itemId || 'N/A';
        const articleName = itemObj?.description || itemRow.description || 'N/A';
        const divisionName = (itemObj?.division?.name || 'N/A').toUpperCase();
        const genderName = (itemObj?.gender?.name || 'N/A').toUpperCase();
        const silhouetteName = (itemObj?.silhouette?.name || 'N/A').toUpperCase();

        let prodGroup = subCatGroup.products.find((p) => p.articleCode === articleCode);
        if (!prodGroup) {
          prodGroup = {
            articleCode,
            articleName: articleName.toUpperCase(),
            divisionName,
            genderName,
            silhouetteName,
            variants: [],
            totalQuantity: 0,
            totalAmount: 0,
          };
          subCatGroup.products.push(prodGroup);
        }

        const qty = Number(itemRow.quantity) || 0;
        const unitPrice = Number(itemRow.unitPrice) || 0;
        const lineTotal = Number(itemRow.lineTotal) || qty * unitPrice;
        const colorName = (itemObj?.color?.name || 'N/A').toUpperCase();
        const sizeName = (itemObj?.size?.name || 'N/A').toUpperCase();

        prodGroup.variants.push({
          color: colorName,
          size: sizeName,
          quantity: qty,
          unitPrice,
          lineTotal,
        });

        prodGroup.totalQuantity += qty;
        prodGroup.totalAmount += lineTotal;

        subCatGroup.totalQuantity += qty;
        subCatGroup.totalAmount += lineTotal;

        catGroup.totalQuantity += qty;
        catGroup.totalAmount += lineTotal;

        docGroup.totalQuantity += qty;
        docGroup.totalAmount += lineTotal;

        brandGroup.totalQuantity += qty;
        brandGroup.totalAmount += lineTotal;
      }
    }

    const brands = Array.from(brandMap.values());

    const grandTotals = brands.reduce(
      (acc, b) => {
        acc.quantity += b.totalQuantity;
        acc.amount += b.totalAmount;
        return acc;
      },
      { quantity: 0, amount: 0 },
    );

    return {
      brands,
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
