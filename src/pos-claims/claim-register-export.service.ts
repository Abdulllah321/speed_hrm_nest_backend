import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../database/prisma.service';
import { UploadService } from '../upload/upload.service';

export interface QueueClaimRegisterExportOptions {
  userId: string;
  locationId?: string;
  startDate?: string;
  endDate?: string;
  format: 'xlsx' | 'pdf';
  search?: string;
}

export interface ClaimRegisterReportItem {
  id: string;
  baseCmNumber: string;
  baseCmDate: string;
  claimNumber: string;
  claimDate: string;
  settledInvNumber: string;
  settledDate: string;
  productDescription: string;
  productSku: string;
  size: string;
  hsCode: string;
  quantity: number;
  unitPrice: number;
  taxPercent: number;
  unitPriceWot: number;
  subTotal: number;
  discountAmount: number;
  taxAmount: number;
  netTotal: number;
}

export interface ClaimGroup {
  claimNumber: string;
  claimId: string;
  items: ClaimRegisterReportItem[];
  totals: {
    quantity: number;
    subTotal: number;
    discountAmount: number;
    taxAmount: number;
    netTotal: number;
  };
}

export interface OutletClaimGroup {
  locationId: string;
  locationName: string;
  claims: ClaimGroup[];
  totals: {
    quantity: number;
    subTotal: number;
    discountAmount: number;
    taxAmount: number;
    netTotal: number;
  };
}

export interface ClaimRegisterReportResult {
  outlets: OutletClaimGroup[];
  grandTotals: {
    quantity: number;
    subTotal: number;
    discountAmount: number;
    taxAmount: number;
    netTotal: number;
  };
  startDate: string;
  endDate: string;
}

@Injectable()
export class ClaimRegisterExportService {
  private readonly logger = new Logger(ClaimRegisterExportService.name);

  constructor(
    @InjectQueue('claim-register-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async getReportData(params: {
    locationId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  }): Promise<ClaimRegisterReportResult> {
    const { locationId, startDate: startStr, endDate: endStr, search } = params;

    const now = new Date();
    const startDate = startStr
      ? new Date(startStr)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = endStr
      ? new Date(endStr)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const where: any = {
      submittedAt: {
        gte: startDate,
        lte: endDate,
      },
      status: { in: ['APPROVED', 'PARTIALLY_APPROVED'] },
      voucherId: { not: null },
    };

    if (locationId && locationId.trim() !== '' && locationId !== 'all') {
      const locationIds = locationId
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (locationIds.length > 0) {
        where.salesOrder = {
          locationId: { in: locationIds },
        };
      }
    }

    if (search && search.trim() !== '') {
      const q = search.trim();
      where.OR = [
        { claimNumber: { contains: q, mode: 'insensitive' } },
        { salesOrder: { orderNumber: { contains: q, mode: 'insensitive' } } },
        { salesOrder: { returnNumber: { contains: q, mode: 'insensitive' } } },
        {
          items: {
            some: {
              item: {
                OR: [
                  { sku: { contains: q, mode: 'insensitive' } },
                  { description: { contains: q, mode: 'insensitive' } },
                ],
              },
            },
          },
        },
      ];
    }

    // Fetch locations map
    const locations = await this.prisma.location.findMany({
      select: { id: true, name: true },
    });
    const locationNameMap = new Map<string, string>(
      locations.map((l) => [l.id, l.name]),
    );

    const claims = await this.prisma.posClaim.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      include: {
        salesOrder: {
          select: {
            id: true,
            orderNumber: true,
            returnNumber: true,
            locationId: true,
            createdAt: true,
            items: true,
          },
        },
        items: {
          include: {
            item: {
              include: {
                size: { select: { name: true } },
                hsCode: { select: { hsCode: true } },
              },
            },
          },
        },
        voucher: {
          include: {
            redemptions: {
              include: {
                order: { select: { orderNumber: true, createdAt: true } },
              },
              take: 1,
            },
          },
        },
      },
    });

    const outletMap = new Map<string, OutletClaimGroup>();

    for (const claim of claims) {
      const locId = claim.salesOrder?.locationId || 'UNASSIGNED';
      const locName = locationNameMap.get(locId) || 'Unassigned Outlet';

      const settledRedemption = claim.voucher?.redemptions?.[0];
      const settledInvNumber = settledRedemption?.order?.orderNumber || 'N/A';
      const settledDate = settledRedemption?.order?.createdAt
        ? new Date(settledRedemption.order.createdAt).toLocaleDateString('en-GB')
        : 'N/A';

      const baseCmNumber = claim.salesOrder?.returnNumber || claim.salesOrder?.orderNumber || 'N/A';
      const baseCmDate = claim.salesOrder?.createdAt
        ? new Date(claim.salesOrder.createdAt).toLocaleDateString('en-GB')
        : 'N/A';
      const claimDate = claim.submittedAt
        ? new Date(claim.submittedAt).toLocaleDateString('en-GB')
        : 'N/A';

      const claimItemsList: ClaimRegisterReportItem[] = [];
      const claimTotals = {
        quantity: 0,
        subTotal: 0,
        discountAmount: 0,
        taxAmount: 0,
        netTotal: 0,
      };

      for (const cItem of claim.items) {
        const approvedQty = Number(cItem.approvedQty || 0);
        if (approvedQty <= 0) continue; // Only approved items

        const matchingOrderItem = claim.salesOrder?.items?.find(
          (soi) => soi.id === cItem.salesOrderItemId || soi.itemId === cItem.itemId,
        );

        const qty = approvedQty;
        const unitPaidPrice = Number(cItem.unitPaidPrice || matchingOrderItem?.unitPrice || cItem.item?.unitPrice || 0);

        const taxPercent = Number(matchingOrderItem?.taxPercent || 0);
        const taxMultiplier = 1 + taxPercent / 100;
        const unitPriceWot = taxMultiplier > 0 ? Math.round((unitPaidPrice / taxMultiplier) * 100) / 100 : unitPaidPrice;

        const rawSubTotal = Math.round(qty * unitPriceWot * 100) / 100;

        const itemDisc = Number(matchingOrderItem?.discountAmount || 0);
        const discountAmount = qty > 0 && matchingOrderItem?.quantity ? Math.round((itemDisc / matchingOrderItem.quantity) * qty * 100) / 100 : 0;

        const itemTax = Number(matchingOrderItem?.taxAmount || 0);
        const taxAmount = qty > 0 && matchingOrderItem?.quantity ? Math.round((itemTax / matchingOrderItem.quantity) * qty * 100) / 100 : Math.round((rawSubTotal - discountAmount) * (taxPercent / 100) * 100) / 100;

        const netTotal = Number(cItem.approvedAmount || Math.round(qty * unitPaidPrice * 100) / 100);

        const reportItem: ClaimRegisterReportItem = {
          id: cItem.id,
          baseCmNumber,
          baseCmDate,
          claimNumber: claim.claimNumber,
          claimDate,
          settledInvNumber,
          settledDate,
          productDescription: cItem.item?.description || 'N/A',
          productSku: cItem.item?.sku || 'N/A',
          size: cItem.item?.size?.name || 'N/A',
          hsCode: cItem.item?.hsCodeStr || cItem.item?.hsCode?.hsCode || 'N/A',
          quantity: qty,
          unitPrice: unitPaidPrice,
          taxPercent,
          unitPriceWot,
          subTotal: rawSubTotal,
          discountAmount,
          taxAmount,
          netTotal,
        };

        claimItemsList.push(reportItem);

        claimTotals.quantity += qty;
        claimTotals.subTotal += rawSubTotal;
        claimTotals.discountAmount += discountAmount;
        claimTotals.taxAmount += taxAmount;
        claimTotals.netTotal += netTotal;
      }

      if (claimItemsList.length === 0) continue; // Skip claims with no approved items

      if (!outletMap.has(locId)) {
        outletMap.set(locId, {
          locationId: locId,
          locationName: locName,
          claims: [],
          totals: {
            quantity: 0,
            subTotal: 0,
            discountAmount: 0,
            taxAmount: 0,
            netTotal: 0,
          },
        });
      }

      const outletGroup = outletMap.get(locId)!;

      outletGroup.claims.push({
        claimNumber: claim.claimNumber,
        claimId: claim.id,
        items: claimItemsList,
        totals: claimTotals,
      });

      outletGroup.totals.quantity += claimTotals.quantity;
      outletGroup.totals.subTotal += claimTotals.subTotal;
      outletGroup.totals.discountAmount += claimTotals.discountAmount;
      outletGroup.totals.taxAmount += claimTotals.taxAmount;
      outletGroup.totals.netTotal += claimTotals.netTotal;
    }

    const outlets = Array.from(outletMap.values());
    const grandTotals = outlets.reduce(
      (acc, o) => {
        acc.quantity += o.totals.quantity;
        acc.subTotal += o.totals.subTotal;
        acc.discountAmount += o.totals.discountAmount;
        acc.taxAmount += o.totals.taxAmount;
        acc.netTotal += o.totals.netTotal;
        return acc;
      },
      { quantity: 0, subTotal: 0, discountAmount: 0, taxAmount: 0, netTotal: 0 },
    );

    return {
      outlets,
      grandTotals,
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
    };
  }

  async queueExport(opts: QueueClaimRegisterExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const ext = opts.format === 'pdf' ? 'pdf' : 'xlsx';

    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: `claim-register-${new Date().toISOString().slice(0, 10)}.${ext}`,
        filePath: path.join('uploads', 'exports', `export-${jobId}.${ext}`),
        moduleName: 'CLAIM_REGISTER_REPORT',
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

    this.logger.log(`[ClaimRegisterExport] Queued job ${jobId} for user ${opts.userId} (format: ${opts.format})`);
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
