import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../database/prisma.service';
import { UploadService } from '../upload/upload.service';

export interface QueueCostOfSalesExportOptions {
  userId: string;
  locationId?: string;
  startDate?: string;
  endDate?: string;
  format: 'xlsx' | 'pdf';
  search?: string;
}

export interface CostOfSalesSizeItem {
  id: string;
  size: string;
  quantity: number;
  costPrice: number;
  totalCost: number;
}

export interface CostOfSalesProductNode {
  sku: string;
  description: string;
  productLabel: string;
  sizes: CostOfSalesSizeItem[];
  totals: {
    quantity: number;
    totalCost: number;
  };
}

export interface CostOfSalesCategoryNode {
  categoryId: string;
  categoryName: string;
  products: CostOfSalesProductNode[];
  totals: {
    quantity: number;
    totalCost: number;
  };
}

export interface CostOfSalesGenderNode {
  genderId: string;
  genderName: string;
  categories: CostOfSalesCategoryNode[];
  totals: {
    quantity: number;
    totalCost: number;
  };
}

export interface CostOfSalesBrandNode {
  brandId: string;
  brandName: string;
  genders: CostOfSalesGenderNode[];
  totals: {
    quantity: number;
    totalCost: number;
  };
}

export interface CostOfSalesDivisionNode {
  divisionId: string;
  divisionName: string;
  brands: CostOfSalesBrandNode[];
  totals: {
    quantity: number;
    totalCost: number;
  };
}

export interface CostOfSalesOutletNode {
  locationId: string;
  locationName: string;
  divisions: CostOfSalesDivisionNode[];
  totals: {
    quantity: number;
    totalCost: number;
  };
}

export interface CostOfSalesReportResult {
  outlets: CostOfSalesOutletNode[];
  grandTotals: {
    quantity: number;
    totalCost: number;
  };
  startDate: string;
  endDate: string;
}

@Injectable()
export class CostOfSalesExportService {
  private readonly logger = new Logger(CostOfSalesExportService.name);

  constructor(
    @InjectQueue('cost-of-sales-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async getReportData(params: {
    locationId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  }): Promise<CostOfSalesReportResult> {
    const { locationId, startDate: startStr, endDate: endStr, search } = params;

    const now = new Date();
    const startDate = startStr
      ? new Date(startStr)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = endStr
      ? new Date(endStr)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const where: any = {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
      status: {
        notIn: ['voided', 'cancelled', 'draft'],
      },
    };

    if (locationId && locationId.trim() !== '' && locationId !== 'all') {
      const locationIds = locationId
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (locationIds.length > 0) {
        where.locationId = { in: locationIds };
      }
    }

    if (search && search.trim() !== '') {
      const q = search.trim();
      where.items = {
        some: {
          item: {
            OR: [
              { sku: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
              { brand: { name: { contains: q, mode: 'insensitive' } } },
              { division: { name: { contains: q, mode: 'insensitive' } } },
              { category: { name: { contains: q, mode: 'insensitive' } } },
            ],
          },
        },
      };
    }

    const locations = await this.prisma.location.findMany({
      select: { id: true, name: true },
    });
    const locationNameMap = new Map<string, string>(
      locations.map((l) => [l.id, l.name]),
    );

    const orders = await this.prisma.salesOrder.findMany({
      where,
      select: {
        locationId: true,
        items: {
          select: {
            id: true,
            quantity: true,
            item: {
              select: {
                id: true,
                sku: true,
                description: true,
                unitCost: true,
                division: { select: { id: true, name: true } },
                brand: { select: { id: true, name: true } },
                gender: { select: { id: true, name: true } },
                category: { select: { id: true, name: true } },
                size: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    const outletMap = new Map<string, CostOfSalesOutletNode>();

    for (const order of orders) {
      const locId = order.locationId || 'UNASSIGNED';
      const locName = locationNameMap.get(locId) || 'Unassigned Outlet';

      if (!outletMap.has(locId)) {
        outletMap.set(locId, {
          locationId: locId,
          locationName: locName,
          divisions: [],
          totals: { quantity: 0, totalCost: 0 },
        });
      }

      const outletNode = outletMap.get(locId)!;

      for (const soi of order.items) {
        if (!soi.item) continue;
        const qty = soi.quantity || 1;
        const unitCost = Number(soi.item.unitCost || 0);
        const totalCost = Math.round(qty * unitCost * 100) / 100;

        const divName = soi.item.division?.name || 'Unassigned Division';
        const divId = soi.item.division?.id || 'div-unassigned';

        const brandName = soi.item.brand?.name || 'Unassigned Brand';
        const brandId = soi.item.brand?.id || 'brand-unassigned';

        const genderName = soi.item.gender?.name || 'Unassigned Gender';
        const genderId = soi.item.gender?.id || 'gender-unassigned';

        const catName = soi.item.category?.name || 'Unassigned Category';
        const catId = soi.item.category?.id || 'cat-unassigned';

        const sku = soi.item.sku || 'UNKNOWN-SKU';
        const desc = soi.item.description || 'No Description';
        const sizeName = soi.item.size?.name || 'N/A';

        // 1. Division Level
        let divNode = outletNode.divisions.find((d) => d.divisionId === divId);
        if (!divNode) {
          divNode = {
            divisionId: divId,
            divisionName: divName,
            brands: [],
            totals: { quantity: 0, totalCost: 0 },
          };
          outletNode.divisions.push(divNode);
        }

        // 2. Brand Level
        let brandNode = divNode.brands.find((b) => b.brandId === brandId);
        if (!brandNode) {
          brandNode = {
            brandId,
            brandName,
            genders: [],
            totals: { quantity: 0, totalCost: 0 },
          };
          divNode.brands.push(brandNode);
        }

        // 3. Gender Level
        let genderNode = brandNode.genders.find((g) => g.genderId === genderId);
        if (!genderNode) {
          genderNode = {
            genderId,
            genderName,
            categories: [],
            totals: { quantity: 0, totalCost: 0 },
          };
          brandNode.genders.push(genderNode);
        }

        // 4. Category Level
        let catNode = genderNode.categories.find((c) => c.categoryId === catId);
        if (!catNode) {
          catNode = {
            categoryId: catId,
            categoryName: catName,
            products: [],
            totals: { quantity: 0, totalCost: 0 },
          };
          genderNode.categories.push(catNode);
        }

        // 5. Product Level
        let prodNode = catNode.products.find((p) => p.sku === sku);
        if (!prodNode) {
          prodNode = {
            sku,
            description: desc,
            productLabel: `${desc} (${sku})`,
            sizes: [],
            totals: { quantity: 0, totalCost: 0 },
          };
          catNode.products.push(prodNode);
        }

        // 6. Size Level
        let sizeItem = prodNode.sizes.find((s) => s.size === sizeName);
        if (!sizeItem) {
          sizeItem = {
            id: soi.id,
            size: sizeName,
            quantity: 0,
            costPrice: unitCost,
            totalCost: 0,
          };
          prodNode.sizes.push(sizeItem);
        }

        sizeItem.quantity += qty;
        sizeItem.totalCost += totalCost;

        prodNode.totals.quantity += qty;
        prodNode.totals.totalCost += totalCost;

        catNode.totals.quantity += qty;
        catNode.totals.totalCost += totalCost;

        genderNode.totals.quantity += qty;
        genderNode.totals.totalCost += totalCost;

        brandNode.totals.quantity += qty;
        brandNode.totals.totalCost += totalCost;

        divNode.totals.quantity += qty;
        divNode.totals.totalCost += totalCost;

        outletNode.totals.quantity += qty;
        outletNode.totals.totalCost += totalCost;
      }
    }

    const outlets = Array.from(outletMap.values());
    const grandTotals = outlets.reduce(
      (acc, o) => {
        acc.quantity += o.totals.quantity;
        acc.totalCost += o.totals.totalCost;
        return acc;
      },
      { quantity: 0, totalCost: 0 },
    );

    return {
      outlets,
      grandTotals,
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
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

    this.logger.log(`[CostOfSalesExport] Queued job ${jobId} for user ${opts.userId} (format: ${opts.format})`);
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
