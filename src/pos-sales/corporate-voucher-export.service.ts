import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../database/prisma.service';
import { UploadService } from '../upload/upload.service';

export interface QueueCorporateVoucherExportOptions {
  userId: string;
  locationId?: string;
  startDate?: string;
  endDate?: string;
  format: 'xlsx' | 'pdf';
  search?: string;
}

export interface CorporateVoucherItem {
  id: string;
  voucherNumber: string;
  dateTime: string;
  companyName: string;
  companyGlCode: string;
  customerDetail: string;
  validTill: string;
  outletName: string;
  discountAmount: number;
  faceValue: number;
  settledInInvoice: string;
  settledDateTime: string;
  status: string;
}

export interface CorporateClientSummaryItem {
  companyName: string;
  abbr: string;
  totalVouchers: number;
  totalFaceValue: number;
  redeemedCount: number;
  redeemedValue: number;
  outstandingCount: number;
  outstandingValue: number;
  denominations: Array<{ value: number; count: number }>;
  firstIssuedDate: string | null;
  lastIssuedDate: string | null;
}

export interface GroupedCorporateVoucherReportResult {
  clients: CorporateClientSummaryItem[];
  kpis: {
    totalClients: number;
    totalVouchers: number;
    totalFaceValue: number;
    totalRedeemedCount: number;
    totalRedeemedValue: number;
    totalOutstandingCount: number;
    totalOutstandingValue: number;
  };
  distinctAbbreviations: string[];
  startDate?: string;
  endDate?: string;
}

export interface CorporateVoucherReportResult {
  items: CorporateVoucherItem[];
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
export class CorporateVoucherExportService {
  private readonly logger = new Logger(CorporateVoucherExportService.name);

  constructor(
    @InjectQueue('corporate-voucher-export')
    private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async getReportData(params: {
    locationId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
    companyName?: string;
    abbr?: string;
  }): Promise<CorporateVoucherReportResult> {
    const { locationId, startDate: startStr, endDate: endStr, search, companyName, abbr } = params;

    const where: any = {
      isDeleted: false,
      voucherType: 'CORPORATE',
    };

    if (startStr && startStr !== 'all' && startStr !== 'ALL') {
      where.createdAt = where.createdAt || {};
      where.createdAt.gte = new Date(startStr);
    }
    if (endStr && endStr !== 'all' && endStr !== 'ALL') {
      where.createdAt = where.createdAt || {};
      where.createdAt.lte = new Date(endStr);
    }

    if (companyName && companyName !== 'all') {
      where.companyName = { equals: companyName, mode: 'insensitive' };
    }

    if (abbr && abbr !== 'all') {
      where.companyGlCode = { equals: abbr, mode: 'insensitive' };
    }

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
        { companyName: { contains: q, mode: 'insensitive' } },
        { companyGlCode: { contains: q, mode: 'insensitive' } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
        { customer: { contactNo: { contains: q, mode: 'insensitive' } } },
        {
          redemptions: {
            some: {
              order: { orderNumber: { contains: q, mode: 'insensitive' } },
            },
          },
        },
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
        transactions: {
          orderBy: { createdAt: 'desc' },
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

    const items: CorporateVoucherItem[] = [];

    let totalAmount = 0;
    let totalDiscount = 0;
    let totalSettledAmount = 0;

    for (const v of vouchers) {
      const faceValue = Number(v.faceValue || 0);
      const discountVal = Number(v.discount || 0);

      totalAmount += faceValue;
      totalDiscount += discountVal;

      const compName = v.companyName || 'Unassigned Corporate Account';
      const compGl = v.companyGlCode || '-';

      let custDetail = 'Unassigned Beneficiary';
      if (v.customer?.name) {
        custDetail = v.customer.contactNo
          ? `${v.customer.name} (${v.customer.contactNo})`
          : v.customer.name;
      }

      const validTillStr = v.expiresAt
        ? new Date(v.expiresAt).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
        : 'No Expiry';

      const dtStr = new Date(v.createdAt).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      const outletName = v.issuedByLocationId
        ? locationMap.get(v.issuedByLocationId) ||
          'Head Office / Corporate Store'
        : 'Head Office / Corporate Store';

      let settledInInvoice = 'Pending / Unsettled';
      let settledDtStr = '-';
      const statusStr = v.isRedeemed ? 'REDEEMED' : 'ACTIVE';

      if (v.redemptions && v.redemptions.length > 0) {
        const redemptionOrders = v.redemptions
          .map((r) => r.order?.orderNumber)
          .filter(Boolean);
        if (redemptionOrders.length > 0) {
          settledInInvoice = redemptionOrders.join(', ');
        }

        const latestRedemption = v.redemptions[v.redemptions.length - 1];
        if (latestRedemption?.createdAt) {
          settledDtStr = new Date(latestRedemption.createdAt).toLocaleString(
            'en-GB',
            {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            },
          );
        }

        for (const r of v.redemptions) {
          totalSettledAmount += Number(r.amountUsed || 0);
        }
      } else if (v.isRedeemed) {
        const redeemTx = v.transactions?.find((t) => t.action === 'REDEEMED');
        if (redeemTx) {
          settledInInvoice = redeemTx.notes || 'Settled (Legacy)';
          if (redeemTx.createdAt) {
            settledDtStr = new Date(redeemTx.createdAt).toLocaleString(
              'en-GB',
              {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              },
            );
          }
        } else {
          settledInInvoice = 'Settled (Historical)';
        }
        totalSettledAmount += faceValue;
      }

      items.push({
        id: v.id,
        voucherNumber: v.code,
        dateTime: dtStr,
        companyName: compName,
        companyGlCode: compGl,
        customerDetail: custDetail,
        validTill: validTillStr,
        outletName,
        discountAmount: discountVal,
        faceValue,
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
      startDate: startStr || 'All Time',
      endDate: endStr || 'All Time',
    };
  }

  /**
   * Grouped corporate vouchers by Client and Abbreviation for high-level management review.
   */
  async getGroupedClientReport(params: {
    locationId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
    abbr?: string;
    status?: string; // 'ALL' | 'OUTSTANDING' | 'REDEEMED'
  }): Promise<GroupedCorporateVoucherReportResult> {
    const { locationId, startDate: startStr, endDate: endStr, search, abbr, status } = params;

    const where: any = {
      isDeleted: false,
      voucherType: 'CORPORATE',
    };

    if (startStr && startStr !== 'all' && startStr !== 'ALL') {
      where.createdAt = where.createdAt || {};
      where.createdAt.gte = new Date(startStr);
    }
    if (endStr && endStr !== 'all' && endStr !== 'ALL') {
      where.createdAt = where.createdAt || {};
      where.createdAt.lte = new Date(endStr);
    }

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

    if (abbr && abbr.trim() !== '' && abbr !== 'all') {
      where.companyGlCode = { equals: abbr.trim(), mode: 'insensitive' };
    }

    if (search && search.trim() !== '') {
      const q = search.trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { companyName: { contains: q, mode: 'insensitive' } },
        { companyGlCode: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (status === 'OUTSTANDING') {
      where.isRedeemed = false;
      where.isActive = true;
    } else if (status === 'REDEEMED') {
      where.isRedeemed = true;
    }

    // Fetch lightweight list of all corporate vouchers for accurate grouping
    const vouchers = await this.prisma.voucher.findMany({
      where,
      select: {
        id: true,
        companyName: true,
        companyGlCode: true,
        faceValue: true,
        isRedeemed: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const clientMap = new Map<
      string,
      {
        companyName: string;
        abbr: string;
        totalVouchers: number;
        totalFaceValue: number;
        redeemedCount: number;
        redeemedValue: number;
        outstandingCount: number;
        outstandingValue: number;
        denominationsMap: Map<number, number>;
        firstDate: Date | null;
        lastDate: Date | null;
      }
    >();

    const abbrSet = new Set<string>();

    let grandTotalVouchers = 0;
    let grandTotalFaceValue = 0;
    let grandRedeemedCount = 0;
    let grandRedeemedValue = 0;
    let grandOutstandingCount = 0;
    let grandOutstandingValue = 0;

    for (const v of vouchers) {
      const cName = v.companyName?.trim() || 'Unassigned Corporate Client';
      const cAbbr = v.companyGlCode?.trim() || 'N/A';
      if (cAbbr && cAbbr !== 'N/A') abbrSet.add(cAbbr);

      const key = `${cName}:::${cAbbr}`;
      const fVal = Number(v.faceValue || 0);
      const isRedeemed = Boolean(v.isRedeemed);
      const isOutstanding = !isRedeemed && Boolean(v.isActive);

      grandTotalVouchers++;
      grandTotalFaceValue += fVal;
      if (isRedeemed) {
        grandRedeemedCount++;
        grandRedeemedValue += fVal;
      }
      if (isOutstanding) {
        grandOutstandingCount++;
        grandOutstandingValue += fVal;
      }

      let group = clientMap.get(key);
      if (!group) {
        group = {
          companyName: cName,
          abbr: cAbbr,
          totalVouchers: 0,
          totalFaceValue: 0,
          redeemedCount: 0,
          redeemedValue: 0,
          outstandingCount: 0,
          outstandingValue: 0,
          denominationsMap: new Map<number, number>(),
          firstDate: v.createdAt,
          lastDate: v.createdAt,
        };
        clientMap.set(key, group);
      }

      group.totalVouchers++;
      group.totalFaceValue += fVal;
      if (isRedeemed) {
        group.redeemedCount++;
        group.redeemedValue += fVal;
      }
      if (isOutstanding) {
        group.outstandingCount++;
        group.outstandingValue += fVal;
      }

      const currDenomCount = group.denominationsMap.get(fVal) || 0;
      group.denominationsMap.set(fVal, currDenomCount + 1);

      if (v.createdAt) {
        if (!group.firstDate || v.createdAt < group.firstDate) {
          group.firstDate = v.createdAt;
        }
        if (!group.lastDate || v.createdAt > group.lastDate) {
          group.lastDate = v.createdAt;
        }
      }
    }

    const clients: CorporateClientSummaryItem[] = Array.from(
      clientMap.values(),
    ).map((g) => {
      const denominations = Array.from(g.denominationsMap.entries())
        .sort((a, b) => b[0] - a[0])
        .map(([value, count]) => ({ value, count }));

      return {
        companyName: g.companyName,
        abbr: g.abbr,
        totalVouchers: g.totalVouchers,
        totalFaceValue: g.totalFaceValue,
        redeemedCount: g.redeemedCount,
        redeemedValue: g.redeemedValue,
        outstandingCount: g.outstandingCount,
        outstandingValue: g.outstandingValue,
        denominations,
        firstIssuedDate: g.firstDate ? g.firstDate.toISOString() : null,
        lastIssuedDate: g.lastDate ? g.lastDate.toISOString() : null,
      };
    });

    // Sort by totalFaceValue descending
    clients.sort((a, b) => b.totalFaceValue - a.totalFaceValue);

    return {
      clients,
      kpis: {
        totalClients: clients.length,
        totalVouchers: grandTotalVouchers,
        totalFaceValue: grandTotalFaceValue,
        totalRedeemedCount: grandRedeemedCount,
        totalRedeemedValue: grandRedeemedValue,
        totalOutstandingCount: grandOutstandingCount,
        totalOutstandingValue: grandOutstandingValue,
      },
      distinctAbbreviations: Array.from(abbrSet).sort(),
      startDate: startStr,
      endDate: endStr,
    };
  }

  /**
   * On-demand fetch of individual vouchers for a specific corporate client.
   */
  async getClientVouchers(params: {
    companyName: string;
    abbr?: string;
    status?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    locationId?: string;
    page?: number;
    limit?: number;
  }) {
    const {
      companyName,
      abbr,
      status,
      search,
      startDate: startStr,
      endDate: endStr,
      locationId,
      page = 1,
      limit = 50,
    } = params;
    const skip = (page - 1) * limit;

    const where: any = {
      isDeleted: false,
      voucherType: 'CORPORATE',
      companyName: { equals: companyName.trim(), mode: 'insensitive' },
    };

    if (abbr && abbr !== 'N/A' && abbr.trim() !== '' && abbr !== 'all') {
      where.companyGlCode = { equals: abbr.trim(), mode: 'insensitive' };
    }

    if (startStr && startStr !== 'all' && startStr !== 'ALL') {
      where.createdAt = where.createdAt || {};
      where.createdAt.gte = new Date(startStr);
    }
    if (endStr && endStr !== 'all' && endStr !== 'ALL') {
      where.createdAt = where.createdAt || {};
      where.createdAt.lte = new Date(endStr);
    }

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

    if (status === 'OUTSTANDING') {
      where.isRedeemed = false;
      where.isActive = true;
    } else if (status === 'REDEEMED') {
      where.isRedeemed = true;
    }

    if (search && search.trim() !== '') {
      where.code = { contains: search.trim(), mode: 'insensitive' };
    }

    const locations = await this.prisma.location.findMany({
      select: { id: true, name: true },
    });
    const locationMap = new Map(locations.map((l) => [l.id, l.name]));

    const [vouchers, total] = await Promise.all([
      this.prisma.voucher.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ isRedeemed: 'asc' }, { createdAt: 'desc' }, { code: 'asc' }],
        include: {
          customer: { select: { name: true, contactNo: true } },
          redemptions: {
            include: {
              order: {
                select: {
                  id: true,
                  orderNumber: true,
                  createdAt: true,
                  locationId: true,
                },
              },
            },
          },
          transactions: { orderBy: { createdAt: 'desc' } },
        },
      }),
      this.prisma.voucher.count({ where }),
    ]);

    const items = vouchers.map((v) => {
      let customerDetail = 'Unassigned Beneficiary';
      if (v.customer?.name) {
        customerDetail = `${v.customer.name}${v.customer.contactNo ? ` (${v.customer.contactNo})` : ''}`;
      }
      const outletName = v.issuedByLocationId
        ? locationMap.get(v.issuedByLocationId) || v.issuedByLocationId
        : 'Head Office / Corporate Store';

      let settledInInvoice = 'Pending / Unsettled';
      let settledOutlet = '-';
      let settledDateTime = '-';

      if (v.redemptions && v.redemptions.length > 0) {
        const orderNums = v.redemptions
          .map((r) => r.order?.orderNumber)
          .filter(Boolean);
        settledInInvoice = orderNums.length > 0 ? orderNums.join(', ') : 'Settled';
        const lastR = v.redemptions[v.redemptions.length - 1];
        if (lastR?.order?.locationId) {
          settledOutlet =
            locationMap.get(lastR.order.locationId) || lastR.order.locationId;
        }
        if (lastR?.createdAt) {
          settledDateTime = new Date(lastR.createdAt).toLocaleString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
        }
      } else if (v.isRedeemed) {
        const rTx = v.transactions?.find((t) => t.action === 'REDEEMED');
        settledInInvoice = rTx?.notes || 'Settled (Historical)';
        if (rTx?.locationId) {
          settledOutlet = locationMap.get(rTx.locationId) || rTx.locationId;
        }
        if (rTx?.createdAt) {
          settledDateTime = new Date(rTx.createdAt).toLocaleString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
        }
      }

      const dateTimeFormatted = v.createdAt
        ? new Date(v.createdAt).toLocaleString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '-';

      return {
        id: v.id,
        code: v.code,
        voucherNumber: v.code,
        companyName: v.companyName || companyName,
        companyGlCode: v.companyGlCode || abbr || '-',
        faceValue: Number(v.faceValue || 0),
        discount: Number(v.discount || 0),
        discountAmount: Number(v.discount || 0),
        status: v.isRedeemed ? 'REDEEMED' : v.isActive ? 'ACTIVE' : 'EXPIRED',
        customerDetail,
        outletName,
        issuedAt: dateTimeFormatted,
        dateTime: dateTimeFormatted,
        expiresAt: v.expiresAt
          ? new Date(v.expiresAt).toLocaleDateString('en-GB', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })
          : '31 Oct 2027',
        validTill: v.expiresAt
          ? new Date(v.expiresAt).toLocaleDateString('en-GB', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })
          : '31 Oct 2027',
        settledInInvoice,
        settledOutlet,
        settledDateTime,
      };
    });

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async queueExport(
    opts: QueueCorporateVoucherExportOptions,
  ): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const ext = opts.format === 'pdf' ? 'pdf' : 'xlsx';

    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: `corporate-voucher-report-${new Date().toISOString().slice(0, 10)}.${ext}`,
        filePath: path.join('uploads', 'exports', `export-${jobId}.${ext}`),
        moduleName: 'CORPORATE_VOUCHER_REPORT',
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

    this.logger.log(
      `[CorporateVoucherExport] Queued job ${jobId} for user ${opts.userId} (format: ${opts.format})`,
    );
    return { jobId };
  }

  async getJobStatus(
    jobId: string,
  ): Promise<{ state: string; progress: number }> {
    const job = await this.exportQueue.getJob(jobId);
    if (!job) throw new NotFoundException(`Export job ${jobId} not found`);
    const state = await job.getState();
    const progress =
      typeof job.progress() === 'number' ? (job.progress() as number) : 0;
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
      this.logger.warn(
        `Could not update export download count for job ${jobId}: ${err.message}`,
      );
    }

    if (record.filePath.startsWith('s3://')) {
      const s3Key = record.filePath.replace('s3://', '');
      const signedUrl = await this.uploadService.getSignedUrlForDownload(s3Key);
      return res.redirect(signedUrl, 302);
    }

    if (
      record.filePath.startsWith('http://') ||
      record.filePath.startsWith('https://')
    ) {
      return res.redirect(record.filePath, 302);
    }

    const filePath = path.join(process.cwd(), record.filePath);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Export file not found.');
    }

    const stat = fs.statSync(filePath);
    const stream = fs.createReadStream(filePath);

    const isPdf = record.fileName.endsWith('.pdf');
    res.header(
      'Content-Type',
      isPdf
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.header(
      'Content-Disposition',
      `attachment; filename="${record.fileName}"`,
    );
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(stream);
  }
}
