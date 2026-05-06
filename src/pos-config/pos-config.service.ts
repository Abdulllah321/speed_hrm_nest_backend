import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { runInBackground } from '../common/utils/run-in-background.util';
@Injectable()
export class PosConfigService {
    constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) { }

    // ══════════════════════════════════════════════════════════════
    //  PROMO CAMPAIGNS
    // ══════════════════════════════════════════════════════════════

    async listPromos() {
        try {
            const promos = await this.prisma.promoCampaign.findMany({
                include: { locations: { include: { location: { select: { id: true, name: true, code: true } } } } },
                orderBy: { createdAt: 'desc' },
            });
            return { status: true, data: promos };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    async getPromoById(id: string) {
        try {
            const promo = await this.prisma.promoCampaign.findUnique({
                where: { id },
                include: { locations: { include: { location: { select: { id: true, name: true, code: true } } } } },
            });
            if (!promo) return { status: false, message: 'Promo campaign not found' };
            return { status: true, data: promo };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    async createPromo(data: {
        name: string;
        code: string;
        type: string;
        value: number;
        minOrderAmount?: number;
        maxDiscount?: number;
        startDate: string;
        endDate: string;
        isActive?: boolean;
        locationIds: string[];
    }, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const promo = await this.prisma.promoCampaign.create({
                data: {
                    name: data.name,
                    code: data.code.toUpperCase(),
                    type: data.type,
                    value: data.value,
                    minOrderAmount: data.minOrderAmount,
                    maxDiscount: data.maxDiscount,
                    startDate: new Date(data.startDate),
                    endDate: new Date(data.endDate),
                    isActive: data.isActive ?? true,
                    locations: {
                        create: data.locationIds.map(locId => ({ locationId: locId })),
                    },
                },
                include: { locations: { include: { location: true } } },
            });

            runInBackground(
                'Create Promo Campaign',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'create',
                    module: 'pos-config',
                    entity: 'PromoCampaign',
                    entityId: promo.id,
                    description: `Created promo campaign ${promo.name} (${promo.code})`,
                    newValues: JSON.stringify(data),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return { status: true, data: promo, message: 'Promo campaign created' };
        } catch (error: any) {
            runInBackground(
                'Create Promo Campaign (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'create',
                    module: 'pos-config',
                    entity: 'PromoCampaign',
                    description: `Failed to create promo campaign`,
                    errorMessage: error?.message,
                    newValues: JSON.stringify(data),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            return { status: false, message: error.message };
        }
    }

    async updatePromo(id: string, data: {
        name?: string;
        code?: string;
        type?: string;
        value?: number;
        minOrderAmount?: number;
        maxDiscount?: number;
        startDate?: string;
        endDate?: string;
        isActive?: boolean;
        locationIds?: string[];
    }, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const oldPromo = await this.prisma.promoCampaign.findUnique({ where: { id } });
            
            // If locationIds provided, replace junction records
            if (data.locationIds) {
                await this.prisma.promoCampaignLocation.deleteMany({ where: { promoId: id } });
            }
            const promo = await this.prisma.promoCampaign.update({
                where: { id },
                data: {
                    ...(data.name && { name: data.name }),
                    ...(data.code && { code: data.code.toUpperCase() }),
                    ...(data.type && { type: data.type }),
                    ...(data.value !== undefined && { value: data.value }),
                    ...(data.minOrderAmount !== undefined && { minOrderAmount: data.minOrderAmount }),
                    ...(data.maxDiscount !== undefined && { maxDiscount: data.maxDiscount }),
                    ...(data.startDate && { startDate: new Date(data.startDate) }),
                    ...(data.endDate && { endDate: new Date(data.endDate) }),
                    ...(data.isActive !== undefined && { isActive: data.isActive }),
                    ...(data.locationIds && {
                        locations: {
                            create: data.locationIds.map(locId => ({ locationId: locId })),
                        },
                    }),
                },
                include: { locations: { include: { location: true } } },
            });

            runInBackground(
                'Update Promo Campaign',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-config',
                    entity: 'PromoCampaign',
                    entityId: promo.id,
                    description: `Updated promo campaign ${promo.name} (${promo.code})`,
                    oldValues: JSON.stringify(oldPromo),
                    newValues: JSON.stringify(data),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return { status: true, data: promo, message: 'Promo campaign updated' };
        } catch (error: any) {
            runInBackground(
                'Update Promo Campaign (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-config',
                    entity: 'PromoCampaign',
                    entityId: id,
                    description: `Failed to update promo campaign`,
                    errorMessage: error?.message,
                    newValues: JSON.stringify(data),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            return { status: false, message: error.message };
        }
    }

    async deletePromo(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const promo = await this.prisma.promoCampaign.findUnique({ where: { id } });
            await this.prisma.promoCampaign.delete({ where: { id } });

            runInBackground(
                'Delete Promo Campaign',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'delete',
                    module: 'pos-config',
                    entity: 'PromoCampaign',
                    entityId: id,
                    description: `Deleted promo campaign ${promo?.name} (${promo?.code})`,
                    oldValues: JSON.stringify(promo),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return { status: true, message: 'Promo campaign deleted' };
        } catch (error: any) {
            runInBackground(
                'Delete Promo Campaign (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'delete',
                    module: 'pos-config',
                    entity: 'PromoCampaign',
                    entityId: id,
                    description: `Failed to delete promo campaign`,
                    errorMessage: error?.message,
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            return { status: false, message: error.message };
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  COUPON CODES
    // ══════════════════════════════════════════════════════════════

    async listCoupons() {
        try {
            const coupons = await this.prisma.couponCode.findMany({
                include: { locations: { include: { location: { select: { id: true, name: true, code: true } } } } },
                orderBy: { createdAt: 'desc' },
            });
            return { status: true, data: coupons };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    async getCouponById(id: string) {
        try {
            const coupon = await this.prisma.couponCode.findUnique({
                where: { id },
                include: { locations: { include: { location: { select: { id: true, name: true, code: true } } } } },
            });
            if (!coupon) return { status: false, message: 'Coupon code not found' };
            return { status: true, data: coupon };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    async createCoupon(data: {
        code: string;
        description?: string;
        discountType: string;
        discountValue: number;
        maxUses?: number;
        minOrderAmount?: number;
        maxDiscount?: number;
        expiresAt?: string;
        isActive?: boolean;
        locationIds: string[];
    }, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const coupon = await this.prisma.couponCode.create({
                data: {
                    code: data.code.toUpperCase(),
                    description: data.description,
                    discountType: data.discountType,
                    discountValue: data.discountValue,
                    maxUses: data.maxUses,
                    minOrderAmount: data.minOrderAmount,
                    maxDiscount: data.maxDiscount,
                    expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
                    isActive: data.isActive ?? true,
                    locations: {
                        create: data.locationIds.map(locId => ({ locationId: locId })),
                    },
                },
                include: { locations: { include: { location: true } } },
            });

            runInBackground(
                'Create Coupon Code',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'create',
                    module: 'pos-config',
                    entity: 'CouponCode',
                    entityId: coupon.id,
                    description: `Created coupon code ${coupon.code}`,
                    newValues: JSON.stringify(data),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return { status: true, data: coupon, message: 'Coupon code created' };
        } catch (error: any) {
            runInBackground(
                'Create Coupon Code (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'create',
                    module: 'pos-config',
                    entity: 'CouponCode',
                    description: `Failed to create coupon code`,
                    errorMessage: error?.message,
                    newValues: JSON.stringify(data),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            return { status: false, message: error.message };
        }
    }

    async updateCoupon(id: string, data: {
        code?: string;
        description?: string;
        discountType?: string;
        discountValue?: number;
        maxUses?: number;
        minOrderAmount?: number;
        maxDiscount?: number;
        expiresAt?: string;
        isActive?: boolean;
        locationIds?: string[];
    }, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const oldCoupon = await this.prisma.couponCode.findUnique({ where: { id } });

            if (data.locationIds) {
                await this.prisma.couponCodeLocation.deleteMany({ where: { couponId: id } });
            }
            const coupon = await this.prisma.couponCode.update({
                where: { id },
                data: {
                    ...(data.code && { code: data.code.toUpperCase() }),
                    ...(data.description !== undefined && { description: data.description }),
                    ...(data.discountType && { discountType: data.discountType }),
                    ...(data.discountValue !== undefined && { discountValue: data.discountValue }),
                    ...(data.maxUses !== undefined && { maxUses: data.maxUses }),
                    ...(data.minOrderAmount !== undefined && { minOrderAmount: data.minOrderAmount }),
                    ...(data.maxDiscount !== undefined && { maxDiscount: data.maxDiscount }),
                    ...(data.expiresAt && { expiresAt: new Date(data.expiresAt) }),
                    ...(data.isActive !== undefined && { isActive: data.isActive }),
                    ...(data.locationIds && {
                        locations: {
                            create: data.locationIds.map(locId => ({ locationId: locId })),
                        },
                    }),
                },
                include: { locations: { include: { location: true } } },
            });

            runInBackground(
                'Update Coupon Code',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-config',
                    entity: 'CouponCode',
                    entityId: coupon.id,
                    description: `Updated coupon code ${coupon.code}`,
                    oldValues: JSON.stringify(oldCoupon),
                    newValues: JSON.stringify(data),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return { status: true, data: coupon, message: 'Coupon code updated' };
        } catch (error: any) {
            runInBackground(
                'Update Coupon Code (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-config',
                    entity: 'CouponCode',
                    entityId: id,
                    description: `Failed to update coupon code`,
                    errorMessage: error?.message,
                    newValues: JSON.stringify(data),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            return { status: false, message: error.message };
        }
    }

    async deleteCoupon(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const coupon = await this.prisma.couponCode.findUnique({ where: { id } });
            await this.prisma.couponCode.delete({ where: { id } });

            runInBackground(
                'Delete Coupon Code',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'delete',
                    module: 'pos-config',
                    entity: 'CouponCode',
                    entityId: id,
                    description: `Deleted coupon code ${coupon?.code}`,
                    oldValues: JSON.stringify(coupon),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return { status: true, message: 'Coupon code deleted' };
        } catch (error: any) {
            runInBackground(
                'Delete Coupon Code (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'delete',
                    module: 'pos-config',
                    entity: 'CouponCode',
                    entityId: id,
                    description: `Failed to delete coupon code`,
                    errorMessage: error?.message,
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            return { status: false, message: error.message };
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  VOUCHERS (POS-issued discount vouchers)
    //  Stored as CouponCode with discountType = 'voucher'
    //  No location restriction — redeemable at any POS terminal
    // ══════════════════════════════════════════════════════════════

    async listVouchers() {
        try {
            const vouchers = await this.prisma.couponCode.findMany({
                where: { discountType: 'voucher' },
                orderBy: { createdAt: 'desc' },
            });
            return { status: true, data: vouchers };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    async createVoucher(data: {
        amount: number;
        description?: string;
        expiresAt?: string;
        issuedBy?: string;
    }, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            // Auto-generate a unique voucher code: VCH-XXXXXX
            const code = `VCH-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

            const voucher = await this.prisma.couponCode.create({
                data: {
                    code,
                    description: data.description ?? `Voucher issued by ${data.issuedBy ?? 'POS'}`,
                    discountType: 'voucher',
                    discountValue: data.amount,
                    maxUses: 1,           // single-use
                    isActive: true,
                    expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
                    // No locations → valid at all POS terminals
                },
            });

            runInBackground(
                'Create Voucher',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'create',
                    module: 'pos-config',
                    entity: 'CouponCode',
                    entityId: voucher.id,
                    description: `Created voucher ${voucher.code}`,
                    newValues: JSON.stringify(data),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return { status: true, data: voucher, message: `Voucher ${code} created` };
        } catch (error: any) {
            runInBackground(
                'Create Voucher (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'create',
                    module: 'pos-config',
                    entity: 'CouponCode',
                    description: `Failed to create voucher`,
                    errorMessage: error?.message,
                    newValues: JSON.stringify(data),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            return { status: false, message: error.message };
        }
    }

    async deactivateVoucher(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const voucher = await this.prisma.couponCode.update({
                where: { id },
                data: { isActive: false },
            });

            runInBackground(
                'Deactivate Voucher',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-config',
                    entity: 'CouponCode',
                    entityId: voucher.id,
                    description: `Deactivated voucher ${voucher.code}`,
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return { status: true, data: voucher, message: 'Voucher deactivated' };
        } catch (error: any) {
            runInBackground(
                'Deactivate Voucher (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-config',
                    entity: 'CouponCode',
                    entityId: id,
                    description: `Failed to deactivate voucher`,
                    errorMessage: error?.message,
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            return { status: false, message: error.message };
        }
    }

    async deleteVoucher(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            // Only allow deleting unused vouchers
            const voucher = await this.prisma.couponCode.findUnique({ where: { id } });
            if (!voucher) return { status: false, message: 'Voucher not found' };
            if (voucher.usedCount > 0) return { status: false, message: 'Cannot delete a voucher that has been redeemed' };
            
            await this.prisma.couponCode.delete({ where: { id } });

            runInBackground(
                'Delete Voucher',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'delete',
                    module: 'pos-config',
                    entity: 'CouponCode',
                    entityId: id,
                    description: `Deleted voucher ${voucher.code}`,
                    oldValues: JSON.stringify(voucher),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return { status: true, message: 'Voucher deleted' };
        } catch (error: any) {
            runInBackground(
                'Delete Voucher (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'delete',
                    module: 'pos-config',
                    entity: 'CouponCode',
                    entityId: id,
                    description: `Failed to delete voucher`,
                    errorMessage: error?.message,
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            return { status: false, message: error.message };
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  ALLIANCE DISCOUNTS
    // ══════════════════════════════════════════════════════════════

    async listAlliances() {
        try {
            const alliances = await this.prisma.allianceDiscount.findMany({
                include: { locations: { include: { location: { select: { id: true, name: true, code: true } } } } },
                orderBy: { createdAt: 'desc' },
            });
            return { status: true, data: alliances };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    async getAllianceById(id: string) {
        try {
            const alliance = await this.prisma.allianceDiscount.findUnique({
                where: { id },
                include: { locations: { include: { location: { select: { id: true, name: true, code: true } } } } },
            });
            if (!alliance) return { status: false, message: 'Alliance discount not found' };
            return { status: true, data: alliance };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    async createAlliance(data: {
        partnerName: string;
        code: string;
        discountPercent: number;
        maxDiscount?: number;
        description?: string;
        startDate?: string;
        endDate?: string;
        isActive?: boolean;
        locationIds: string[];
        binNumbers?: string[];
    }, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            // Validate BIN numbers: each must be 4–8 digits
            const bins = (data.binNumbers ?? []).map(b => b.trim()).filter(Boolean);
            for (const bin of bins) {
                if (!/^\d{4,8}$/.test(bin)) {
                    return { status: false, message: `Invalid BIN "${bin}". Each BIN must be 4–8 digits.` };
                }
            }

            const alliance = await this.prisma.allianceDiscount.create({
                data: {
                    partnerName: data.partnerName,
                    code: data.code.toUpperCase(),
                    discountPercent: data.discountPercent,
                    maxDiscount: data.maxDiscount,
                    description: data.description,
                    startDate: data.startDate ? new Date(data.startDate) : undefined,
                    endDate: data.endDate ? new Date(data.endDate) : undefined,
                    isActive: data.isActive ?? true,
                    binNumbers: bins,
                    locations: {
                        create: data.locationIds.map(locId => ({ locationId: locId })),
                    },
                },
                include: { locations: { include: { location: true } } },
            });

            runInBackground(
                'Create Alliance Discount',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'create',
                    module: 'pos-config',
                    entity: 'AllianceDiscount',
                    entityId: alliance.id,
                    description: `Created alliance discount for ${alliance.partnerName} (${alliance.code})`,
                    newValues: JSON.stringify(data),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return { status: true, data: alliance, message: 'Alliance discount created' };
        } catch (error: any) {
            runInBackground(
                'Create Alliance Discount (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'create',
                    module: 'pos-config',
                    entity: 'AllianceDiscount',
                    description: `Failed to create alliance discount`,
                    errorMessage: error?.message,
                    newValues: JSON.stringify(data),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            return { status: false, message: error.message };
        }
    }

    async updateAlliance(id: string, data: {
        partnerName?: string;
        code?: string;
        discountPercent?: number;
        maxDiscount?: number;
        description?: string;
        startDate?: string;
        endDate?: string;
        isActive?: boolean;
        locationIds?: string[];
        binNumbers?: string[];
    }, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const oldAlliance = await this.prisma.allianceDiscount.findUnique({ where: { id } });

            // Validate BIN numbers if provided
            if (data.binNumbers !== undefined) {
                const bins = data.binNumbers.map(b => b.trim()).filter(Boolean);
                for (const bin of bins) {
                    if (!/^\d{4,8}$/.test(bin)) {
                        return { status: false, message: `Invalid BIN "${bin}". Each BIN must be 4–8 digits.` };
                    }
                }
                data.binNumbers = bins;
            }

            if (data.locationIds) {
                await this.prisma.allianceDiscountLocation.deleteMany({ where: { allianceId: id } });
            }
            const alliance = await this.prisma.allianceDiscount.update({
                where: { id },
                data: {
                    ...(data.partnerName && { partnerName: data.partnerName }),
                    ...(data.code && { code: data.code.toUpperCase() }),
                    ...(data.discountPercent !== undefined && { discountPercent: data.discountPercent }),
                    ...(data.maxDiscount !== undefined && { maxDiscount: data.maxDiscount }),
                    ...(data.description !== undefined && { description: data.description }),
                    ...(data.startDate !== undefined && { startDate: data.startDate ? new Date(data.startDate) : null }),
                    ...(data.endDate !== undefined && { endDate: data.endDate ? new Date(data.endDate) : null }),
                    ...(data.isActive !== undefined && { isActive: data.isActive }),
                    ...(data.binNumbers !== undefined && { binNumbers: data.binNumbers }),
                    ...(data.locationIds && {
                        locations: {
                            create: data.locationIds.map(locId => ({ locationId: locId })),
                        },
                    }),
                },
                include: { locations: { include: { location: true } } },
            });

            runInBackground(
                'Update Alliance Discount',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-config',
                    entity: 'AllianceDiscount',
                    entityId: alliance.id,
                    description: `Updated alliance discount for ${alliance.partnerName} (${alliance.code})`,
                    oldValues: JSON.stringify(oldAlliance),
                    newValues: JSON.stringify(data),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return { status: true, data: alliance, message: 'Alliance discount updated' };
        } catch (error: any) {
            runInBackground(
                'Update Alliance Discount (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-config',
                    entity: 'AllianceDiscount',
                    entityId: id,
                    description: `Failed to update alliance discount`,
                    errorMessage: error?.message,
                    newValues: JSON.stringify(data),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            return { status: false, message: error.message };
        }
    }

    async deleteAlliance(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const alliance = await this.prisma.allianceDiscount.findUnique({ where: { id } });
            await this.prisma.allianceDiscount.delete({ where: { id } });

            runInBackground(
                'Delete Alliance Discount',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'delete',
                    module: 'pos-config',
                    entity: 'AllianceDiscount',
                    entityId: id,
                    description: `Deleted alliance discount for ${alliance?.partnerName} (${alliance?.code})`,
                    oldValues: JSON.stringify(alliance),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return { status: true, message: 'Alliance discount deleted' };
        } catch (error: any) {
            runInBackground(
                'Delete Alliance Discount (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'delete',
                    module: 'pos-config',
                    entity: 'AllianceDiscount',
                    entityId: id,
                    description: `Failed to delete alliance discount`,
                    errorMessage: error?.message,
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            return { status: false, message: error.message };
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  POS-FACING: Checkout Config (location-scoped)
    // ══════════════════════════════════════════════════════════════

    async getCheckoutConfig(locationId: string) {
        try {
            const now = new Date();

            // Active promos for this location
            const promos = await this.prisma.promoCampaign.findMany({
                where: {
                    isActive: true,
                    startDate: { lte: now },
                    endDate: { gte: now },
                    locations: { some: { locationId } },
                },
                orderBy: { name: 'asc' },
            });

            // Active alliance discounts for this location
            const alliances = await this.prisma.allianceDiscount.findMany({
                where: {
                    isActive: true,
                    locations: { some: { locationId } },
                },
                orderBy: { partnerName: 'asc' },
            });

            return {
                status: true,
                data: { promos, alliances },
            };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    async validateCoupon(code: string, locationId: string, orderSubtotal: number) {
        try {
            const coupon = await this.prisma.couponCode.findUnique({
                where: { code: code.toUpperCase() },
                include: { locations: true },
            });

            if (!coupon) {
                return { status: false, message: 'Coupon not found' };
            }
            if (!coupon.isActive) {
                return { status: false, message: 'Coupon is inactive' };
            }
            if (coupon.expiresAt && coupon.expiresAt < new Date()) {
                return { status: false, message: 'Coupon has expired' };
            }
            if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
                return { status: false, message: 'Coupon usage limit reached' };
            }
            if (coupon.minOrderAmount && orderSubtotal < Number(coupon.minOrderAmount)) {
                return { status: false, message: `Minimum order amount is ${coupon.minOrderAmount}` };
            }

            // Check location scope
            const locationMatch = coupon.locations.some(l => l.locationId === locationId);
            if (coupon.locations.length > 0 && !locationMatch) {
                return { status: false, message: 'Coupon not valid at this location' };
            }

            // Calculate discount
            let discountAmount: number;
            if (coupon.discountType === 'percent') {
                discountAmount = Math.round(orderSubtotal * (Number(coupon.discountValue) / 100));
                if (coupon.maxDiscount) {
                    discountAmount = Math.min(discountAmount, Number(coupon.maxDiscount));
                }
            } else {
                discountAmount = Number(coupon.discountValue);
            }

            return {
                status: true,
                data: {
                    id: coupon.id,
                    code: coupon.code,
                    discountType: coupon.discountType,
                    discountValue: Number(coupon.discountValue),
                    discountAmount,
                    description: coupon.description,
                },
                message: 'Coupon is valid',
            };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }
}
