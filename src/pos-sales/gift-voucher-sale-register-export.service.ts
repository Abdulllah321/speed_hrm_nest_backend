import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../database/prisma.service';
import { UploadService } from '../upload/upload.service';

export interface QueueGiftVoucherSaleRegisterExportOptions {
  userId: string;
  locationId?: string;
  startDate?: string;
  endDate?: string;
  format: 'xlsx' | 'pdf';
  search?: string;
}

export interface GiftVoucherSaleRegisterItem {
  id: string;
  voucherNumber: string;
  voucherType: string;
  dateTime: string;
  outletName: string;
  customerDetail: string;
  validTill: string;
  discountAmount: number;
  amount: number;
  baseInvoiceNumber: string;
  settledInInvoice: string;
  settledDateTime: string;
  status: string;
}

export interface GiftVoucherSaleRegisterReportResult {
  items: GiftVoucherSaleRegisterItem[];
  kpis: {
    totalVouchers: number;
    totalAmount: number;
    totalDiscount: number;
    totalSettledAmount: number;
  };
  startDate: string;
  endDate: string;
}

@Injectable()
export class GiftVoucherSaleRegisterExportService {
  private readonly logger = new Logger(GiftVoucherSaleRegisterExportService.name);

  constructor(
    @InjectQueue('gift-voucher-sale-register-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async getReportData(params: {
    locationId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  }): Promise<GiftVoucherSaleRegisterReportResult> {
    const { locationId, startDate: startStr, endDate: endStr, search } = params;

    const now = new Date();
    const startDate = startStr
      ? new Date(startStr)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = endStr
      ? new Date(endStr)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const where: any = {
      isDeleted: false,
      voucherType: { in: ['GIFT', 'OUTLET_GIFT'] },
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (locationId && locationId.trim() !== '' && locationId !== 'all') {
      const locationIds = locationId
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (locationIds.length > 0) {
        where.OR = [
          { issuedByLocationId: { in: locationIds } },
          { locations: { some: { locationId: { in: locationIds } } } },
        ];
      }
    }

    if (search && search.trim() !== '') {
      const q = search.trim();
      const searchConditions = [
        { code: { contains: q, mode: 'insensitive' } },
        { voucherType: { contains: q, mode: 'insensitive' } },
        { companyName: { contains: q, mode: 'insensitive' } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
        { customer: { contactNo: { contains: q, mode: 'insensitive' } } },
        { redemptions: { some: { order: { orderNumber: { contains: q, mode: 'insensitive' } } } } },
      ];

      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: searchConditions }];
        delete where.OR;
      } else {
        where.OR = searchConditions;
      }
    }

    const locations = await this.prisma.location.findMany({
      select: { id: true, name: true },
    });
    const locationMap = new Map(locations.map((l) => [l.id, l.name]));

    const vouchers = await this.prisma.voucher.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            contactNo: true,
          },
        },
        claims: {
          select: {
            id: true,
            claimNumber: true,
          },
        },
        redemptions: {
          include: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    const sourceOrderIds = vouchers
      .map((v) => v.sourceOrderId)
      .filter((id): id is string => !!id);

    const sourceOrders = sourceOrderIds.length > 0
      ? await this.prisma.salesOrder.findMany({
          where: { id: { in: sourceOrderIds } },
          select: { id: true, orderNumber: true, returnNumber: true },
        })
      : [];

    const sourceOrderMap = new Map(sourceOrders.map((o) => [o.id, o]));

    const items: GiftVoucherSaleRegisterItem[] = [];

    let totalAmount = 0;
    let totalDiscount = 0;
    let totalSettledAmount = 0;

    for (const v of vouchers) {
      const faceValue = Number(v.faceValue || 0);
      const discountVal = Number(v.discount || 0);

      totalAmount += faceValue;
      totalDiscount += discountVal;

      let custDetail = 'Walk-in Customer';
      if (v.customer?.name) {
        custDetail = v.customer.contactNo
          ? `${v.customer.name} (${v.customer.contactNo})`
          : v.customer.name;
      } else if (v.companyName) {
        custDetail = `Company: ${v.companyName}`;
      }

      const validTillStr = v.expiresAt
        ? new Date(v.expiresAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : 'No Expiry';

      const dtStr = new Date(v.createdAt).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      const outletName = v.issuedByLocationId
        ? locationMap.get(v.issuedByLocationId) || 'Head Office / Store'
        : 'Head Office / Store';

      let baseInvoiceNumber = '-';
      if (v.claims && v.claims.length > 0) {
        baseInvoiceNumber = v.claims.map((c) => c.claimNumber).join(', ');
      } else if (v.sourceOrderId) {
        const srcOrd = sourceOrderMap.get(v.sourceOrderId);
        if (srcOrd) {
          baseInvoiceNumber = srcOrd.returnNumber || srcOrd.orderNumber;
        }
      }

      let settledInInvoice = 'Pending / Unsettled';
      let settledDtStr = '-';
      let statusStr = v.isRedeemed ? 'REDEEMED' : 'ACTIVE';

      if (v.redemptions && v.redemptions.length > 0) {
        const redemptionOrders = v.redemptions
          .map((r) => r.order?.orderNumber)
          .filter(Boolean);
        if (redemptionOrders.length > 0) {
          settledInInvoice = redemptionOrders.join(', ');
        }

        const latestRedemption = v.redemptions[v.redemptions.length - 1];
        if (latestRedemption?.createdAt) {
          settledDtStr = new Date(latestRedemption.createdAt).toLocaleString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
        }

        for (const r of v.redemptions) {
          totalSettledAmount += Number(r.amountUsed || 0);
        }
      }

      items.push({
        id: v.id,
        voucherNumber: v.code,
        voucherType: v.voucherType || 'GIFT',
        dateTime: dtStr,
        outletName,
        customerDetail: custDetail,
        validTill: validTillStr,
        discountAmount: discountVal,
        amount: faceValue,
        baseInvoiceNumber,
        settledInInvoice,
        settledDateTime: settledDtStr,
        status: statusStr,
      });
    }

    return {
      items,
      kpis: {
        totalVouchers: items.length,
        totalAmount: Math.round(totalAmount * 100) / 100,
        totalDiscount: Math.round(totalDiscount * 100) / 100,
        totalSettledAmount: Math.round(totalSettledAmount * 100) / 100,
      },
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
    };
  }

  async queueExport(opts: QueueGiftVoucherSaleRegisterExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const ext = opts.format === 'pdf' ? 'pdf' : 'xlsx';

    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: `gift-voucher-sale-register-${new Date().toISOString().slice(0, 10)}.${ext}`,
        filePath: path.join('uploads', 'exports', `export-${jobId}.${ext}`),
        moduleName: 'GIFT_VOUCHER_SALE_REGISTER_REPORT',
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

    this.logger.log(`[GiftVoucherSaleRegisterExport] Queued job ${jobId} for user ${opts.userId} (format: ${opts.format})`);
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
