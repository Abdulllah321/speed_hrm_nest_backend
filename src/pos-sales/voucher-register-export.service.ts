import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../database/prisma.service';
import { UploadService } from '../upload/upload.service';

export interface QueueVoucherRegisterExportOptions {
  userId: string;
  voucherType?: string;
  status?: string;
  locationId?: string;
  startDate?: string;
  endDate?: string;
  asOfDate?: string;
  isOutstandingOnly?: boolean;
  format: 'xlsx' | 'pdf';
  search?: string;
}

export interface VoucherRegisterItem {
  id: string;
  voucherNumber: string;
  voucherType: string;
  dateTime: string;
  createdAtRaw: string;
  companyName: string;
  companyGlCode: string;
  customerDetail: string;
  customerName?: string;
  customerPhone?: string;
  outletName: string;
  baseCashMemo: string;
  validTill: string;
  expiresAtRaw?: string | null;
  isExpired?: boolean;
  daysToExpiry?: number | null;
  discountAmount: number;
  faceValue: number;
  netValue: number;
  settledInCashMemo: string;
  settledDateTime: string;
  settledAmount: number;
  outstandingAmount: number;
  status: string; // 'ACTIVE', 'REDEEMED', 'EXPIRED'
  paymentMode?: string;
  merchantName?: string;
  slipNo?: string;
  cardholderName?: string;
  cardLast4?: string;
  description?: string;
  redemptionList?: Array<{
    orderNumber: string;
    amountUsed: number;
    dateTime: string;
  }>;
}

export interface VoucherRegisterReportResult {
  items: VoucherRegisterItem[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
  kpis: {
    totalVouchers: number;
    totalAmount: number;
    totalDiscount: number;
    totalNetValue: number;
    totalSettledAmount: number;
    totalOutstandingAmount: number;
    totalOutstandingCount: number;
    totalRedeemedCount: number;
    totalActiveCount: number;
    totalExpiredCount: number;
    typeBreakdown: Record<string, number>;
    typeBreakdownDetails: Record<
      string,
      {
        count: number;
        faceValue: number;
        discount: number;
        settledAmount: number;
        outstandingAmount: number;
        redeemedCount: number;
        outstandingCount: number;
        activeCount: number;
        expiredCount: number;
      }
    >;
    statusBreakdown: Record<string, number>;
  };
  startDate: string;
  endDate: string;
  asOfDate?: string;
  isOutstandingOnly?: boolean;
}

@Injectable()
export class VoucherRegisterExportService {
  private readonly logger = new Logger(VoucherRegisterExportService.name);

  constructor(
    @InjectQueue('voucher-register-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async getReportData(params: {
    voucherType?: string;
    status?: string;
    locationId?: string;
    startDate?: string;
    endDate?: string;
    asOfDate?: string;
    isOutstandingOnly?: boolean;
    search?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortDirection?: 'asc' | 'desc';
  }): Promise<VoucherRegisterReportResult> {
    const {
      voucherType,
      status,
      locationId,
      startDate: startStr,
      endDate: endStr,
      asOfDate: asOfDateStr,
      isOutstandingOnly,
      search,
      page,
      limit,
      sortBy,
      sortDirection,
    } = params;

    const now = new Date();
    const isOutstandingMode = Boolean(isOutstandingOnly) || status === 'OUTSTANDING';

    let startDate: Date | undefined;
    let endDate: Date;

    if (isOutstandingMode) {
      // In Outstanding Mode: preview all unredeemed vouchers issued on or before asOfDate/today
      const targetAsOf = asOfDateStr
        ? new Date(asOfDateStr)
        : endStr
        ? new Date(endStr)
        : now;
      targetAsOf.setHours(23, 59, 59, 999);
      endDate = targetAsOf;

      if (startStr && startStr.trim() !== '') {
        startDate = new Date(startStr);
      }
    } else {
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      const startYear = currentMonth >= 6 ? currentYear : currentYear - 1;
      const endYear = startYear + 1;

      startDate = startStr
        ? new Date(startStr)
        : new Date(startYear, 6, 1, 0, 0, 0, 0); // July 1st
      endDate = endStr
        ? new Date(endStr)
        : new Date(endYear, 5, 30, 23, 59, 59, 999); // June 30th
    }

    const baseWhere: any = {
      isDeleted: false,
    };

    if (isOutstandingMode) {
      baseWhere.isRedeemed = false;
      baseWhere.createdAt = {
        lte: endDate,
      };
      if (startDate) {
        baseWhere.createdAt.gte = startDate;
      }
    } else {
      baseWhere.createdAt = {
        gte: startDate,
        lte: endDate,
      };

      // Filter by Status in normal period mode
      if (status && status !== 'ALL') {
        if (status === 'ACTIVE') {
          baseWhere.isRedeemed = false;
        } else if (status === 'REDEEMED') {
          baseWhere.isRedeemed = true;
        }
      }
    }

    // Filter by Location
    if (locationId && locationId.trim() !== '' && locationId !== 'all') {
      const locationIds = locationId
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (locationIds.length > 0) {
        baseWhere.OR = [
          { issuedByLocationId: { in: locationIds } },
          { locations: { some: { locationId: { in: locationIds } } } },
        ];
      }
    }

    // Filter by Search Query
    if (search && search.trim() !== '') {
      const q = search.trim();
      const searchConditions = [
        { code: { contains: q, mode: 'insensitive' } },
        { voucherType: { contains: q, mode: 'insensitive' } },
        { companyName: { contains: q, mode: 'insensitive' } },
        { companyGlCode: { contains: q, mode: 'insensitive' } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
        { customer: { contactNo: { contains: q, mode: 'insensitive' } } },
        { customer: { cnicNo: { contains: q, mode: 'insensitive' } } },
        { redemptions: { some: { order: { orderNumber: { contains: q, mode: 'insensitive' } } } } },
      ];

      if (baseWhere.OR) {
        baseWhere.AND = [{ OR: baseWhere.OR }, { OR: searchConditions }];
        delete baseWhere.OR;
      } else {
        baseWhere.OR = searchConditions;
      }
    }

    // Database aggregation: compute precise counts and face values per voucher type across the base scope
    const [dbTypeStatusGroups, dbExpiredTypeGroups] = await Promise.all([
      this.prisma.voucher.groupBy({
        by: ['voucherType', 'isRedeemed'],
        where: baseWhere,
        _count: { _all: true },
        _sum: { faceValue: true, discount: true },
      }),
      this.prisma.voucher.groupBy({
        by: ['voucherType'],
        where: { ...baseWhere, isRedeemed: false, expiresAt: { lt: now } },
        _count: { _all: true },
      }),
    ]);

    const typeBreakdown: Record<string, number> = {
      CORPORATE: 0,
      REFUND: 0,
      GIFT: 0,
      EXCHANGE: 0,
      CLAIM: 0,
      CREDIT: 0,
    };

    const typeBreakdownDetails: Record<
      string,
      {
        count: number;
        faceValue: number;
        discount: number;
        settledAmount: number;
        outstandingAmount: number;
        redeemedCount: number;
        outstandingCount: number;
        activeCount: number;
        expiredCount: number;
      }
    > = {
      CORPORATE: { count: 0, faceValue: 0, discount: 0, settledAmount: 0, outstandingAmount: 0, redeemedCount: 0, outstandingCount: 0, activeCount: 0, expiredCount: 0 },
      REFUND: { count: 0, faceValue: 0, discount: 0, settledAmount: 0, outstandingAmount: 0, redeemedCount: 0, outstandingCount: 0, activeCount: 0, expiredCount: 0 },
      GIFT: { count: 0, faceValue: 0, discount: 0, settledAmount: 0, outstandingAmount: 0, redeemedCount: 0, outstandingCount: 0, activeCount: 0, expiredCount: 0 },
      EXCHANGE: { count: 0, faceValue: 0, discount: 0, settledAmount: 0, outstandingAmount: 0, redeemedCount: 0, outstandingCount: 0, activeCount: 0, expiredCount: 0 },
      CLAIM: { count: 0, faceValue: 0, discount: 0, settledAmount: 0, outstandingAmount: 0, redeemedCount: 0, outstandingCount: 0, activeCount: 0, expiredCount: 0 },
      CREDIT: { count: 0, faceValue: 0, discount: 0, settledAmount: 0, outstandingAmount: 0, redeemedCount: 0, outstandingCount: 0, activeCount: 0, expiredCount: 0 },
    };

    for (const group of dbTypeStatusGroups) {
      const rawType = (group.voucherType || 'GIFT').toUpperCase();
      const mappedType = rawType === 'OUTLET_GIFT' ? 'GIFT' : rawType;
      const count = group._count?._all || 0;
      const faceVal = Number(group._sum?.faceValue || 0);
      const disc = Number(group._sum?.discount || 0);

      typeBreakdown[mappedType] = (typeBreakdown[mappedType] || 0) + count;

      if (!typeBreakdownDetails[mappedType]) {
        typeBreakdownDetails[mappedType] = {
          count: 0,
          faceValue: 0,
          discount: 0,
          settledAmount: 0,
          outstandingAmount: 0,
          redeemedCount: 0,
          outstandingCount: 0,
          activeCount: 0,
          expiredCount: 0,
        };
      }
      typeBreakdownDetails[mappedType].count += count;
      typeBreakdownDetails[mappedType].faceValue += faceVal;
      typeBreakdownDetails[mappedType].discount += disc;

      if (group.isRedeemed) {
        typeBreakdownDetails[mappedType].settledAmount += faceVal;
        typeBreakdownDetails[mappedType].redeemedCount += count;
      } else {
        typeBreakdownDetails[mappedType].outstandingAmount += faceVal;
        typeBreakdownDetails[mappedType].outstandingCount += count;
      }
    }

    for (const expGroup of dbExpiredTypeGroups) {
      const rawType = (expGroup.voucherType || 'GIFT').toUpperCase();
      const mappedType = rawType === 'OUTLET_GIFT' ? 'GIFT' : rawType;
      const expCount = expGroup._count?._all || 0;
      if (typeBreakdownDetails[mappedType]) {
        typeBreakdownDetails[mappedType].expiredCount = expCount;
      }
    }

    for (const key of Object.keys(typeBreakdownDetails)) {
      const detail = typeBreakdownDetails[key];
      detail.activeCount = Math.max(0, detail.outstandingCount - (detail.expiredCount || 0));
    }

    // Build items query (filter by voucherType if specific type requested)
    const itemsWhere: any = { ...baseWhere };
    if (voucherType && voucherType.trim() !== '' && voucherType !== 'ALL') {
      const vTypeUpper = voucherType.trim().toUpperCase();
      if (vTypeUpper === 'GIFT') {
        itemsWhere.voucherType = { in: ['GIFT', 'OUTLET_GIFT'] };
      } else {
        itemsWhere.voucherType = vTypeUpper;
      }
    }

    // Global KPIs computation across the filtered scope (itemsWhere)
    const [
      totalCount,
      aggregateSummary,
      redeemedSummary,
      unredeemedSummary,
      expiredCount,
    ] = await Promise.all([
      this.prisma.voucher.count({ where: itemsWhere }),
      this.prisma.voucher.aggregate({
        where: itemsWhere,
        _sum: { faceValue: true, discount: true },
      }),
      this.prisma.voucher.aggregate({
        where: { ...itemsWhere, isRedeemed: true },
        _sum: { faceValue: true },
        _count: { _all: true },
      }),
      this.prisma.voucher.aggregate({
        where: { ...itemsWhere, isRedeemed: false },
        _sum: { faceValue: true },
        _count: { _all: true },
      }),
      this.prisma.voucher.count({
        where: { ...itemsWhere, isRedeemed: false, expiresAt: { lt: now } },
      }),
    ]);

    const totalAmount = Number(aggregateSummary._sum?.faceValue || 0);
    const totalDiscount = Number(aggregateSummary._sum?.discount || 0);
    const totalNetValue = Math.max(0, totalAmount - totalDiscount);
    const totalSettledAmount = Number(redeemedSummary._sum?.faceValue || 0);
    const totalOutstandingAmount = Number(unredeemedSummary._sum?.faceValue || 0);
    const totalRedeemedCount = redeemedSummary._count?._all || 0;
    const totalOutstandingCount = unredeemedSummary._count?._all || 0;
    const totalExpiredCount = expiredCount;
    const totalActiveCount = Math.max(0, totalOutstandingCount - totalExpiredCount);

    const statusBreakdown: Record<string, number> = {
      ACTIVE: totalActiveCount,
      REDEEMED: totalRedeemedCount,
      EXPIRED: totalExpiredCount,
    };

    // Sorting definition
    const sortDir: 'asc' | 'desc' = sortDirection === 'asc' ? 'asc' : 'desc';
    let orderBy: any = { createdAt: 'desc' };

    if (sortBy) {
      switch (sortBy) {
        case 'voucherNumber':
        case 'code':
          orderBy = { code: sortDir };
          break;
        case 'voucherType':
          orderBy = { voucherType: sortDir };
          break;
        case 'faceValue':
          orderBy = { faceValue: sortDir };
          break;
        case 'netValue':
          orderBy = { faceValue: sortDir };
          break;
        case 'discountAmount':
        case 'discount':
          orderBy = { discount: sortDir };
          break;
        case 'companyName':
          orderBy = { companyName: sortDir };
          break;
        case 'validTill':
        case 'expiresAt':
          orderBy = { expiresAt: sortDir };
          break;
        case 'status':
          orderBy = [{ isRedeemed: sortDir }, { createdAt: 'desc' }];
          break;
        case 'dateTime':
        case 'createdAt':
        default:
          orderBy = { createdAt: sortDir };
          break;
      }
    }

    // Pagination bounds
    const pageNum = Math.max(1, page || 1);
    const limitNum = limit !== undefined ? limit : 100;
    const isFetchAll = limitNum <= 0;

    const paginationTake = isFetchAll ? undefined : limitNum;
    const paginationSkip = isFetchAll ? undefined : (pageNum - 1) * limitNum;

    const [locations, vouchers] = await Promise.all([
      this.prisma.location.findMany({
        select: { id: true, name: true, code: true },
      }),
      this.prisma.voucher.findMany({
        where: itemsWhere,
        orderBy,
        skip: paginationSkip,
        take: paginationTake,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              contactNo: true,
              cnicNo: true,
              email: true,
            },
          },
          merchant: {
            select: {
              id: true,
              bankName: true,
              description: true,
              tagId: true,
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
                  grandTotal: true,
                },
              },
            },
          },
          transactions: {
            select: {
              id: true,
              amountUsed: true,
              action: true,
              notes: true,
              createdAt: true,
            },
          },
        },
      }),
    ]);

    const locationMap = new Map(locations.map((l) => [l.id, l.name]));

    const sourceOrderIds = vouchers
      .map((v) => v.sourceOrderId)
      .filter((id): id is string => !!id);

    const sourceOrders =
      sourceOrderIds.length > 0
        ? await this.prisma.salesOrder.findMany({
            where: { id: { in: sourceOrderIds } },
            select: { id: true, orderNumber: true, returnNumber: true, refundNumber: true },
          })
        : [];

    const sourceOrderMap = new Map(sourceOrders.map((o) => [o.id, o]));

    const items: VoucherRegisterItem[] = [];

    for (const v of vouchers) {
      const faceValue = Number(v.faceValue || 0);
      const discountVal = Number(v.discount || 0);
      const netVal = Math.max(0, faceValue - discountVal);
      const isRedeemed = Boolean(v.isRedeemed);

      const rawVType = (v.voucherType || 'GIFT').toUpperCase();
      const vType = rawVType === 'OUTLET_GIFT' ? 'GIFT' : rawVType;

      const compName = v.companyName || '-';
      const compGl = v.companyGlCode || '-';

      let custDetail = 'Walk-in Customer';
      if (v.customer?.name) {
        custDetail = v.customer.contactNo
          ? `${v.customer.name} (${v.customer.contactNo})`
          : v.customer.name;
      } else if (v.companyName) {
        custDetail = `Company: ${v.companyName}`;
      }

      // Expiry calculation
      let isExpired = false;
      let daysToExpiry: number | null = null;
      if (v.expiresAt) {
        const expDate = new Date(v.expiresAt);
        const diffMs = expDate.getTime() - now.getTime();
        daysToExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (diffMs < 0 && !isRedeemed) {
          isExpired = true;
        }
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
        ? locationMap.get(v.issuedByLocationId) || 'Head Office / Store'
        : 'Head Office / Store';

      let baseCashMemo = '-';
      if (v.claims && v.claims.length > 0) {
        baseCashMemo = v.claims.map((c) => c.claimNumber).join(', ');
      } else if (v.sourceOrderId) {
        const srcOrd = sourceOrderMap.get(v.sourceOrderId);
        if (srcOrd) {
          baseCashMemo = srcOrd.returnNumber || srcOrd.refundNumber || srcOrd.orderNumber;
        }
      }

      let settledInCashMemo = 'Pending / Unsettled';
      let settledDtStr = '-';
      let itemSettledAmount = 0;
      const redemptionList: Array<{ orderNumber: string; amountUsed: number; dateTime: string }> = [];

      if (v.redemptions && v.redemptions.length > 0) {
        const redemptionOrders = v.redemptions
          .map((r) => r.order?.orderNumber)
          .filter(Boolean);
        if (redemptionOrders.length > 0) {
          settledInCashMemo = redemptionOrders.join(', ');
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
          const amt = Number(r.amountUsed || 0);
          itemSettledAmount += amt;
          redemptionList.push({
            orderNumber: r.order?.orderNumber || 'Invoice',
            amountUsed: amt,
            dateTime: r.createdAt
              ? new Date(r.createdAt).toLocaleString('en-GB', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '-',
          });
        }
      }

      if (isRedeemed && itemSettledAmount === 0) {
        itemSettledAmount = faceValue;
      }

      const itemOutstandingAmount = isRedeemed ? 0 : faceValue;

      // Status classification
      let statusStr = 'ACTIVE';
      if (isRedeemed) {
        statusStr = 'REDEEMED';
      } else if (isExpired) {
        statusStr = 'EXPIRED';
      } else {
        statusStr = 'ACTIVE';
      }

      items.push({
        id: v.id,
        voucherNumber: v.code,
        voucherType: vType,
        dateTime: dtStr,
        createdAtRaw: v.createdAt.toISOString(),
        companyName: compName,
        companyGlCode: compGl,
        customerDetail: custDetail,
        customerName: v.customer?.name || undefined,
        customerPhone: v.customer?.contactNo || undefined,
        outletName,
        baseCashMemo,
        validTill: validTillStr,
        expiresAtRaw: v.expiresAt ? v.expiresAt.toISOString() : null,
        isExpired,
        daysToExpiry,
        discountAmount: discountVal,
        faceValue,
        netValue: netVal,
        settledInCashMemo,
        settledDateTime: settledDtStr,
        settledAmount: itemSettledAmount,
        outstandingAmount: itemOutstandingAmount,
        status: statusStr,
        paymentMode: v.paymentMode || undefined,
        merchantName: v.merchant?.bankName || v.merchant?.description || undefined,
        slipNo: v.slipNo || undefined,
        cardholderName: v.cardholderName || undefined,
        cardLast4: v.cardLast4 || undefined,
        description: v.description || undefined,
        redemptionList: redemptionList.length > 0 ? redemptionList : undefined,
      });
    }

    const totalPages = isFetchAll ? 1 : Math.ceil(totalCount / (limitNum || 1));
    const hasMore = !isFetchAll && pageNum < totalPages;

    return {
      items,
      pagination: {
        page: pageNum,
        limit: isFetchAll ? totalCount : limitNum,
        total: totalCount,
        totalPages,
        hasMore,
      },
      kpis: {
        totalVouchers: totalCount,
        totalAmount: Math.round(totalAmount * 100) / 100,
        totalDiscount: Math.round(totalDiscount * 100) / 100,
        totalNetValue: Math.round(totalNetValue * 100) / 100,
        totalSettledAmount: Math.round(totalSettledAmount * 100) / 100,
        totalOutstandingAmount: Math.round(totalOutstandingAmount * 100) / 100,
        totalOutstandingCount,
        totalRedeemedCount,
        totalActiveCount,
        totalExpiredCount,
        typeBreakdown,
        typeBreakdownDetails,
        statusBreakdown,
      },
      startDate: (startDate || new Date(0)).toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
      asOfDate: isOutstandingMode ? endDate.toISOString().slice(0, 10) : undefined,
      isOutstandingOnly: isOutstandingMode,
    };
  }

  async queueExport(opts: QueueVoucherRegisterExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const ext = opts.format === 'pdf' ? 'pdf' : 'xlsx';
    const prefix = opts.isOutstandingOnly ? 'voucher-outstanding-preview' : 'voucher-register-report';

    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: `${prefix}-${new Date().toISOString().slice(0, 10)}.${ext}`,
        filePath: path.join('uploads', 'exports', `export-${jobId}.${ext}`),
        moduleName: 'VOUCHER_REGISTER_REPORT',
        status: 'PENDING',
      },
    });

    await this.exportQueue.add(
      {
        jobId,
        userId: opts.userId,
        tenantId,
        tenantDbUrl,
        voucherType: opts.voucherType,
        status: opts.status,
        locationId: opts.locationId,
        startDate: opts.startDate,
        endDate: opts.endDate,
        asOfDate: opts.asOfDate,
        isOutstandingOnly: opts.isOutstandingOnly,
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
      `[VoucherRegisterExport] Queued job ${jobId} for user ${opts.userId} (format: ${opts.format}, outstanding: ${opts.isOutstandingOnly})`,
    );
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
    res.header(
      'Content-Type',
      isPdf
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.header('Content-Disposition', `attachment; filename="${record.fileName}"`);
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(stream);
  }
}

