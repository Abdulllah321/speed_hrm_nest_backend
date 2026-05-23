import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { runInBackground } from '../common/utils/run-in-background.util';

export type VoucherType = 'GIFT' | 'EXCHANGE' | 'CREDIT' | 'CORPORATE' | 'OUTLET_GIFT' | 'REFUND';

// Code format per type:
//   GIFT        → GFT-XXXXXX
//   EXCHANGE    → EXC-XXXXXX
//   CREDIT      → CRD-XXXXXX
//   CORPORATE   → CRP-XXXXXX
//   OUTLET_GIFT → OGT-XXXXXX
//   REFUND      → RFD-XXXXXX
function generateCode(type: VoucherType): string {
    const prefix: Record<VoucherType, string> = {
        GIFT: 'GFT',
        EXCHANGE: 'EXC',
        CREDIT: 'CRD',
        CORPORATE: 'CRP',
        OUTLET_GIFT: 'OGT',
        REFUND: 'RFD',
    };
    const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix[type]}-${rand}`;
}

@Injectable()
export class VoucherService {
    constructor(
        private prisma: PrismaService,
        private activityLogs: ActivityLogsService,
    ) {}

    // ── List vouchers (admin) ─────────────────────────────────────
    async listVouchers(filters?: {
        voucherType?: string;
        locationId?: string;
        isActive?: boolean;
        search?: string;
    }) {
        try {
            const where: any = { isDeleted: false };
            if (filters?.voucherType) where.voucherType = filters.voucherType;
            if (filters?.isActive !== undefined) where.isActive = filters.isActive;
            if (filters?.search) {
                where.OR = [
                    { code: { contains: filters.search, mode: 'insensitive' } },
                    { description: { contains: filters.search, mode: 'insensitive' } },
                    { companyName: { contains: filters.search, mode: 'insensitive' } },
                ];
            }
            if (filters?.locationId) {
                where.OR = [
                    { locations: { some: { locationId: filters.locationId } } },
                    { locations: { none: {} } }, // no restriction = all locations
                ];
            }

            const vouchers = await this.prisma.voucher.findMany({
                where,
                include: {
                    locations: { include: { location: { select: { id: true, name: true, code: true } } } },
                    redemptions: { select: { amountUsed: true, orderId: true } },
                },
                orderBy: { createdAt: 'desc' },
            });

            return { status: true, data: vouchers };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    // ── Issue a voucher (admin or POS) ────────────────────────────
    async issueVoucher(data: {
        voucherType: VoucherType;
        faceValue: number;
        description?: string;
        customerId?: string;
        companyName?: string;
        requireCustomerMatch?: boolean;
        issuedByLocationId?: string;
        issuedByUserId?: string;
        sourceOrderId?: string;
        expiresAt?: string;
        locationIds?: string[]; // empty = all locations
    }, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const code = generateCode(data.voucherType);

            // EXCHANGE vouchers are locked to issuing location
            // REFUND vouchers are also locked to issuing location (record-only)
            const locationIds =
                (data.voucherType === 'EXCHANGE' || data.voucherType === 'REFUND') && data.issuedByLocationId
                    ? [data.issuedByLocationId]
                    : (data.locationIds ?? []);

            // REFUND vouchers are immediately marked as redeemed (record-only, not usable)
            const isRefundVoucher = data.voucherType === 'REFUND';

            const voucher = await this.prisma.voucher.create({
                data: {
                    code,
                    voucherType: data.voucherType,
                    faceValue: data.faceValue,
                    description: data.description,
                    customerId: data.customerId,
                    companyName: data.companyName,
                    requireCustomerMatch: data.requireCustomerMatch ?? false,
                    issuedByLocationId: data.issuedByLocationId,
                    issuedByUserId: data.issuedByUserId,
                    sourceOrderId: data.sourceOrderId,
                    expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
                    isActive: !isRefundVoucher, // REFUND vouchers are inactive (not redeemable)
                    isRedeemed: isRefundVoucher, // REFUND vouchers are marked as redeemed
                    locations: {
                        create: locationIds.map((locId) => ({ locationId: locId })),
                    },
                    transactions: {
                        create: {
                            action: isRefundVoucher ? 'ISSUED_REFUND' : 'ISSUED',
                            amountUsed: 0,
                            locationId: data.issuedByLocationId,
                            notes: isRefundVoucher 
                                ? `Refund voucher issued - Cash refunded to customer (Record only)`
                                : `Issued as ${data.voucherType}`,
                        },
                    },
                },
                include: {
                    locations: { include: { location: { select: { id: true, name: true, code: true } } } },
                },
            });

            runInBackground(
                'Issue Voucher',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'create',
                    module: 'pos-config',
                    entity: 'Voucher',
                    entityId: voucher.id,
                    description: `Issued voucher ${voucher.code} (${voucher.voucherType})`,
                    newValues: JSON.stringify(data),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return { status: true, data: voucher, message: `Voucher ${code} issued` };
        } catch (error: any) {
            runInBackground(
                'Issue Voucher (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'create',
                    module: 'pos-config',
                    entity: 'Voucher',
                    description: `Failed to issue voucher`,
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

    // ── Bulk issue vouchers ────────────────────────────────────────
    async bulkIssueVouchers(data: {
        voucherType: VoucherType;
        faceValue: number;
        quantity: number; // max 500 per batch
        description?: string;
        companyName?: string;
        expiresAt?: string;
        locationIds?: string[];
        issuedByLocationId?: string;
        issuedByUserId?: string;
    }, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const qty = Math.min(data.quantity, 500);
            const locationIds = data.locationIds ?? [];

            // Generate all codes upfront and ensure uniqueness
            const codes = new Set<string>();
            while (codes.size < qty) {
                codes.add(generateCode(data.voucherType));
            }

            const expiresAt = data.expiresAt ? new Date(data.expiresAt) : undefined;

            // Use createMany for the vouchers, then batch the junction records
            const created = await this.prisma.$transaction(async (tx) => {
                const vouchers: { id: string; code: string }[] = [];

                for (const code of codes) {
                    const v = await tx.voucher.create({
                        data: {
                            code,
                            voucherType: data.voucherType,
                            faceValue: data.faceValue,
                            description: data.description,
                            companyName: data.companyName,
                            issuedByLocationId: data.issuedByLocationId,
                            issuedByUserId: data.issuedByUserId,
                            expiresAt,
                            locations: {
                                create: locationIds.map((locId) => ({ locationId: locId })),
                            },
                            transactions: {
                                create: {
                                    action: 'ISSUED',
                                    amountUsed: 0,
                                    locationId: data.issuedByLocationId,
                                    notes: `Bulk issued (${qty}) as ${data.voucherType}`,
                                },
                            },
                        },
                        select: { id: true, code: true },
                    });
                    vouchers.push(v);
                }

                return vouchers;
            });

            runInBackground(
                'Bulk Issue Vouchers',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'create',
                    module: 'pos-config',
                    entity: 'Voucher',
                    description: `Bulk issued ${created.length} vouchers of type ${data.voucherType}`,
                    newValues: JSON.stringify(data),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return {
                status: true,
                data: { count: created.length, codes: created.map((v) => v.code) },
                message: `${created.length} vouchers issued successfully`,
            };
        } catch (error: any) {
            runInBackground(
                'Bulk Issue Vouchers (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'create',
                    module: 'pos-config',
                    entity: 'Voucher',
                    description: `Failed to bulk issue vouchers`,
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

    // ── Validate a voucher code at checkout ───────────────────────
    async validateVoucher(
        code: string,
        locationId: string,
        customerId?: string,
    ) {
        try {
            const voucher = await this.prisma.voucher.findFirst({
                where: { code: code.toUpperCase(), isDeleted: false },
                include: {
                    locations: true,
                    redemptions: { select: { amountUsed: true } },
                },
            });

            if (!voucher) return { status: false, message: 'Voucher not found' };
            if (!voucher.isActive) return { status: false, message: 'Voucher has been voided' };
            if (voucher.isRedeemed) return { status: false, message: 'Voucher has already been redeemed' };
            if (voucher.expiresAt && voucher.expiresAt < new Date()) {
                return { status: false, message: 'Voucher has expired' };
            }

            // Location check — if locations list is non-empty, must match
            if (voucher.locations.length > 0) {
                const allowed = voucher.locations.some((l) => l.locationId === locationId);
                if (!allowed) {
                    return { status: false, message: 'Voucher is not valid at this location' };
                }
            }

            // Customer binding check (optional per config)
            if (voucher.requireCustomerMatch && voucher.customerId) {
                if (!customerId || customerId !== voucher.customerId) {
                    return {
                        status: false,
                        message: 'This voucher is bound to a specific customer. Please select the correct customer.',
                    };
                }
            }

            return {
                status: true,
                data: {
                    id: voucher.id,
                    code: voucher.code,
                    voucherType: voucher.voucherType,
                    faceValue: Number(voucher.faceValue),
                    description: voucher.description,
                    customerId: voucher.customerId,
                    requireCustomerMatch: voucher.requireCustomerMatch,
                    expiresAt: voucher.expiresAt,
                },
                message: 'Voucher is valid',
            };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    // ── Redeem voucher(s) during order creation (called inside tx) ─
    async redeemVouchers(
        voucherRedemptions: { voucherId: string; amountUsed: number }[],
        orderId: string,
        locationId: string,
        tx: any,
        ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
    ) {
        const creditVouchers: { code: string; faceValue: number; expiresAt: Date | null }[] = [];

        for (const r of voucherRedemptions) {
            const voucher = await tx.voucher.findUnique({ where: { id: r.voucherId } });
            if (!voucher || !voucher.isActive || voucher.isRedeemed) {
                throw new Error(`Voucher ${r.voucherId} is no longer valid`);
            }

            const faceValue = Number(voucher.faceValue);
            const amountUsed = Number(r.amountUsed);
            const remainingBalance = faceValue - amountUsed;

            // Mark original voucher as redeemed
            await tx.voucher.update({
                where: { id: r.voucherId },
                data: { isRedeemed: true, isActive: false },
            });

            await tx.voucherTransaction.create({
                data: {
                    voucherId: r.voucherId,
                    orderId,
                    locationId,
                    action: 'REDEEMED',
                    amountUsed: r.amountUsed,
                },
            });

            await tx.voucherRedemption.create({
                data: { voucherId: r.voucherId, orderId, amountUsed: r.amountUsed },
            });

            // ── Generate CREDIT voucher for unused balance ──
            // All voucher types (including EXCHANGE) generate credit vouchers for remaining balance
            if (remainingBalance > 0) {
                const creditVoucherCode = this.generateCreditVoucherCode();
                const expiresAt = voucher.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

                const creditVoucher = await tx.voucher.create({
                    data: {
                        code: creditVoucherCode,
                        voucherType: 'CREDIT',
                        faceValue: remainingBalance,
                        description: `Credit voucher for unused balance from ${voucher.code}`,
                        customerId: voucher.customerId,
                        issuedByLocationId: locationId,
                        issuedByUserId: ctx?.userId,
                        sourceOrderId: orderId,
                        expiresAt,
                        isActive: true,
                        isRedeemed: false,
                    },
                });

                // Add location restriction (same as original voucher)
                const originalLocations = await tx.voucherLocation.findMany({
                    where: { voucherId: voucher.id },
                    select: { locationId: true },
                });

                if (originalLocations.length > 0) {
                    await tx.voucherLocation.createMany({
                        data: originalLocations.map(loc => ({
                            voucherId: creditVoucher.id,
                            locationId: loc.locationId,
                        })),
                    });
                }

                // Log credit voucher issuance
                await tx.voucherTransaction.create({
                    data: {
                        voucherId: creditVoucher.id,
                        action: 'ISSUED',
                        amountUsed: 0,
                        locationId,
                        notes: `Credit voucher issued for unused balance of ${voucher.code}`,
                    },
                });

                creditVouchers.push({
                    code: creditVoucher.code,
                    faceValue: remainingBalance,
                    expiresAt: creditVoucher.expiresAt,
                });
            }
        }

        return creditVouchers;
    }

    // Helper to generate credit voucher code
    private generateCreditVoucherCode(): string {
        const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
        return `CRD-${rand}`;
    }

    // ── Auto-issue exchange voucher on return ─────────────────────
    async issueExchangeVoucher(data: {
        faceValue: number;
        sourceOrderId: string;
        issuedByLocationId: string;
        issuedByUserId?: string;
        customerId?: string;
        expiresInDays?: number;
    }, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + (data.expiresInDays ?? 30));

        return this.issueVoucher({
            voucherType: 'EXCHANGE',
            faceValue: data.faceValue,
            description: `Exchange voucher for return of order`,
            customerId: data.customerId,
            issuedByLocationId: data.issuedByLocationId,
            issuedByUserId: data.issuedByUserId,
            sourceOrderId: data.sourceOrderId,
            expiresAt: expiresAt.toISOString(),
        }, ctx);
    }

    // ── Auto-issue refund voucher (record-only, NOT redeemable) ───
    async issueRefundVoucher(data: {
        faceValue: number;
        sourceOrderId: string;
        issuedByLocationId: string;
        issuedByUserId?: string;
        customerId?: string;
    }, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        return this.issueVoucher({
            voucherType: 'REFUND',
            faceValue: data.faceValue,
            description: `Refund voucher - Cash refunded to customer (Record only)`,
            customerId: data.customerId,
            issuedByLocationId: data.issuedByLocationId,
            issuedByUserId: data.issuedByUserId,
            sourceOrderId: data.sourceOrderId,
            // REFUND vouchers are immediately marked as redeemed (record-only)
        }, ctx);
    }

    // ── Void a voucher ────────────────────────────────────────────
    async voidVoucher(id: string, reason?: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const voucher = await this.prisma.voucher.findFirst({ where: { id, isDeleted: false } });
            if (!voucher) return { status: false, message: 'Voucher not found' };
            if (voucher.isRedeemed) return { status: false, message: 'Cannot void a redeemed voucher' };

            await this.prisma.voucher.update({
                where: { id },
                data: { isActive: false, isDeleted: true, deletedAt: new Date() },
            });

            await this.prisma.voucherTransaction.create({
                data: {
                    voucherId: id,
                    action: 'VOIDED',
                    amountUsed: 0,
                    notes: reason ?? 'Voided by staff',
                },
            });

            runInBackground(
                'Void Voucher',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-config',
                    entity: 'Voucher',
                    entityId: id,
                    description: `Voided voucher ${voucher.code}. Reason: ${reason ?? 'N/A'}`,
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return { status: true, message: 'Voucher voided' };
        } catch (error: any) {
            runInBackground(
                'Void Voucher (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-config',
                    entity: 'Voucher',
                    entityId: id,
                    description: `Failed to void voucher`,
                    errorMessage: error?.message,
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            return { status: false, message: error.message };
        }
    }

    // ── Restore voucher on order void/return ──────────────────────
    async restoreVoucher(voucherId: string, orderId: string, locationId: string, tx: any) {
        await tx.voucher.update({
            where: { id: voucherId },
            data: { isRedeemed: false, isActive: true },
        });

        await tx.voucherTransaction.create({
            data: {
                voucherId,
                orderId,
                locationId,
                action: 'RESTORED',
                amountUsed: 0,
                notes: 'Restored due to order void/return',
            },
        });
    }

    // ── Get voucher detail ────────────────────────────────────────
    async getVoucher(id: string) {
        try {
            const voucher = await this.prisma.voucher.findFirst({
                where: { id, isDeleted: false },
                include: {
                    locations: { include: { location: { select: { id: true, name: true, code: true } } } },
                    transactions: { orderBy: { createdAt: 'desc' } },
                    redemptions: { include: { order: { select: { orderNumber: true, createdAt: true } } } },
                },
            });
            if (!voucher) return { status: false, message: 'Voucher not found' };
            return { status: true, data: voucher };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }
}
