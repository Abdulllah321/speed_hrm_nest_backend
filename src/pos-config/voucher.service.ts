import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export type VoucherType = 'GIFT' | 'EXCHANGE' | 'CREDIT' | 'CORPORATE' | 'OUTLET_GIFT';

// Code format per type:
//   GIFT        → GFT-XXXXXX
//   EXCHANGE    → EXC-XXXXXX
//   CREDIT      → CRD-XXXXXX
//   CORPORATE   → CRP-XXXXXX
//   OUTLET_GIFT → OGT-XXXXXX
function generateCode(type: VoucherType): string {
    const prefix: Record<VoucherType, string> = {
        GIFT: 'GFT',
        EXCHANGE: 'EXC',
        CREDIT: 'CRD',
        CORPORATE: 'CRP',
        OUTLET_GIFT: 'OGT',
    };
    const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix[type]}-${rand}`;
}

@Injectable()
export class VoucherService {
    constructor(private prisma: PrismaService) {}

    // ── List vouchers (admin) ─────────────────────────────────────
    async listVouchers(filters?: {
        voucherType?: string;
        locationId?: string;
        isActive?: boolean;
        search?: string;
    }) {
        try {
            const where: any = {};
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
    }) {
        try {
            const code = generateCode(data.voucherType);

            // EXCHANGE vouchers are locked to issuing location
            const locationIds =
                data.voucherType === 'EXCHANGE' && data.issuedByLocationId
                    ? [data.issuedByLocationId]
                    : (data.locationIds ?? []);

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
                    locations: {
                        create: locationIds.map((locId) => ({ locationId: locId })),
                    },
                    transactions: {
                        create: {
                            action: 'ISSUED',
                            amountUsed: 0,
                            locationId: data.issuedByLocationId,
                            notes: `Issued as ${data.voucherType}`,
                        },
                    },
                },
                include: {
                    locations: { include: { location: { select: { id: true, name: true, code: true } } } },
                },
            });

            return { status: true, data: voucher, message: `Voucher ${code} issued` };
        } catch (error: any) {
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
    }) {
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

            return {
                status: true,
                data: { count: created.length, codes: created.map((v) => v.code) },
                message: `${created.length} vouchers issued successfully`,
            };
        } catch (error: any) {
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
            const voucher = await this.prisma.voucher.findUnique({
                where: { code: code.toUpperCase() },
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
    ) {
        for (const r of voucherRedemptions) {
            const voucher = await tx.voucher.findUnique({ where: { id: r.voucherId } });
            if (!voucher || !voucher.isActive || voucher.isRedeemed) {
                throw new Error(`Voucher ${r.voucherId} is no longer valid`);
            }

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
        }
    }

    // ── Auto-issue exchange voucher on return ─────────────────────
    async issueExchangeVoucher(data: {
        faceValue: number;
        sourceOrderId: string;
        issuedByLocationId: string;
        issuedByUserId?: string;
        customerId?: string;
        expiresInDays?: number;
    }) {
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
        });
    }

    // ── Void a voucher ────────────────────────────────────────────
    async voidVoucher(id: string, reason?: string) {
        try {
            const voucher = await this.prisma.voucher.findUnique({ where: { id } });
            if (!voucher) return { status: false, message: 'Voucher not found' };
            if (voucher.isRedeemed) return { status: false, message: 'Cannot void a redeemed voucher' };

            await this.prisma.voucher.update({
                where: { id },
                data: { isActive: false },
            });

            await this.prisma.voucherTransaction.create({
                data: {
                    voucherId: id,
                    action: 'VOIDED',
                    amountUsed: 0,
                    notes: reason ?? 'Voided by staff',
                },
            });

            return { status: true, message: 'Voucher voided' };
        } catch (error: any) {
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
            const voucher = await this.prisma.voucher.findUnique({
                where: { id },
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
