import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { runInBackground } from '../common/utils/run-in-background.util';

export interface CreateMerchantConfigDto {
    description: string;
    costCentreTag: string;
    tagId: string;
    bankName: string;
    merchantCode: number;
    commissionRate: number;
    bankGlCode: string;
    isActive?: boolean;
    locationIds: string[];
}

export interface UpdateMerchantConfigDto extends Partial<CreateMerchantConfigDto> { }

@Injectable()
export class MerchantService {
    constructor(
        private prisma: PrismaService,
        private activityLogs: ActivityLogsService,
    ) { }

    // ─── List all merchant configs ────────────────────────────────────────
    async listMerchants(filters?: { locationId?: string; bankName?: string; isActive?: boolean }) {
        try {
            const where: any = {};
            if (filters?.isActive !== undefined) where.isActive = filters.isActive;
            if (filters?.bankName) where.bankName = { contains: filters.bankName, mode: 'insensitive' };
            if (filters?.locationId) {
                where.locations = { some: { locationId: filters.locationId } };
            }

            const merchants = await this.prisma.merchantConfig.findMany({
                where,
                include: {
                    locations: {
                        include: { location: { select: { id: true, name: true, code: true } } },
                    },
                },
                orderBy: [{ costCentreTag: 'asc' }, { merchantCode: 'asc' }],
            });
            return { status: true, data: merchants };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    // ─── Get single merchant config ───────────────────────────────────────
    async getMerchantById(id: string) {
        try {
            const merchant = await this.prisma.merchantConfig.findUnique({
                where: { id },
                include: {
                    locations: {
                        include: { location: { select: { id: true, name: true, code: true } } },
                    },
                },
            });
            if (!merchant) return { status: false, message: 'Merchant config not found' };
            return { status: true, data: merchant };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    // ─── Get merchants available for a location (POS checkout) ───────────
    async getMerchantsForLocation(locationId: string) {
        try {
            const merchants = await this.prisma.merchantConfig.findMany({
                where: {
                    isActive: true,
                    locations: { some: { locationId } },
                },
                select: {
                    id: true,
                    description: true,
                    costCentreTag: true,
                    tagId: true,
                    bankName: true,
                    merchantCode: true,
                    commissionRate: true,
                    bankGlCode: true,
                },
                orderBy: { merchantCode: 'asc' },
            });
            return { status: true, data: merchants };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    // ─── Create merchant config ───────────────────────────────────────────
    async createMerchant(
        data: CreateMerchantConfigDto,
        ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
    ) {
        try {
            const merchant = await this.prisma.merchantConfig.create({
                data: {
                    description: data.description,
                    costCentreTag: data.costCentreTag,
                    tagId: data.tagId,
                    bankName: data.bankName,
                    merchantCode: data.merchantCode,
                    commissionRate: data.commissionRate,
                    bankGlCode: data.bankGlCode,
                    isActive: data.isActive ?? true,
                    locations: {
                        create: data.locationIds.map((locId) => ({ locationId: locId })),
                    },
                },
                include: {
                    locations: { include: { location: { select: { id: true, name: true, code: true } } } },
                },
            });

            runInBackground(
                'Create Merchant Config',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'create',
                    module: 'pos-config',
                    entity: 'MerchantConfig',
                    entityId: merchant.id,
                    description: `Created merchant config: ${merchant.description}`,
                    newValues: JSON.stringify(data),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return { status: true, data: merchant };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    // ─── Update merchant config ───────────────────────────────────────────
    async updateMerchant(
        id: string,
        data: UpdateMerchantConfigDto,
        ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
    ) {
        try {
            const existing = await this.prisma.merchantConfig.findUnique({ where: { id } });
            if (!existing) return { status: false, message: 'Merchant config not found' };

            const updateData: any = {};
            if (data.description !== undefined) updateData.description = data.description;
            if (data.costCentreTag !== undefined) updateData.costCentreTag = data.costCentreTag;
            if (data.tagId !== undefined) updateData.tagId = data.tagId;
            if (data.bankName !== undefined) updateData.bankName = data.bankName;
            if (data.merchantCode !== undefined) updateData.merchantCode = data.merchantCode;
            if (data.commissionRate !== undefined) updateData.commissionRate = data.commissionRate;
            if (data.bankGlCode !== undefined) updateData.bankGlCode = data.bankGlCode;
            if (data.isActive !== undefined) updateData.isActive = data.isActive;

            // Replace location assignments if provided
            if (data.locationIds !== undefined) {
                await this.prisma.merchantConfigLocation.deleteMany({ where: { merchantConfigId: id } });
                updateData.locations = {
                    create: data.locationIds.map((locId) => ({ locationId: locId })),
                };
            }

            const merchant = await this.prisma.merchantConfig.update({
                where: { id },
                data: updateData,
                include: {
                    locations: { include: { location: { select: { id: true, name: true, code: true } } } },
                },
            });

            runInBackground(
                'Update Merchant Config',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-config',
                    entity: 'MerchantConfig',
                    entityId: id,
                    description: `Updated merchant config: ${merchant.description}`,
                    newValues: JSON.stringify(data),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return { status: true, data: merchant };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    // ─── Delete merchant config ───────────────────────────────────────────
    async deleteMerchant(
        id: string,
        ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
    ) {
        try {
            const existing = await this.prisma.merchantConfig.findUnique({ where: { id } });
            if (!existing) return { status: false, message: 'Merchant config not found' };

            await this.prisma.merchantConfig.delete({ where: { id } });

            runInBackground(
                'Delete Merchant Config',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'delete',
                    module: 'pos-config',
                    entity: 'MerchantConfig',
                    entityId: id,
                    description: `Deleted merchant config: ${existing.description}`,
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return { status: true, message: 'Merchant config deleted successfully' };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    // ─── Bulk upsert (for seeding / CSV import) ───────────────────────────
    async bulkUpsert(
        records: Array<CreateMerchantConfigDto & { locationName?: string }>,
        ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
    ) {
        try {
            let created = 0;
            let updated = 0;

            for (const record of records) {
                // Resolve locationIds from locationName if needed
                let locationIds = record.locationIds;
                if ((!locationIds || locationIds.length === 0) && record.locationName) {
                    const loc = await this.prisma.location.findFirst({
                        where: { name: { contains: record.locationName, mode: 'insensitive' } },
                        select: { id: true },
                    });
                    if (loc) locationIds = [loc.id];
                }

                // Upsert by (tagId + merchantCode) as natural key
                const existing = await this.prisma.merchantConfig.findFirst({
                    where: { tagId: record.tagId, merchantCode: record.merchantCode },
                });

                if (existing) {
                    await this.prisma.merchantConfig.update({
                        where: { id: existing.id },
                        data: {
                            description: record.description,
                            costCentreTag: record.costCentreTag,
                            bankName: record.bankName,
                            commissionRate: record.commissionRate,
                            bankGlCode: record.bankGlCode,
                            isActive: record.isActive ?? true,
                            ...(locationIds?.length ? {
                                locations: {
                                    deleteMany: {},
                                    create: locationIds.map((locId) => ({ locationId: locId })),
                                },
                            } : {}),
                        },
                    });
                    updated++;
                } else {
                    await this.prisma.merchantConfig.create({
                        data: {
                            description: record.description,
                            costCentreTag: record.costCentreTag,
                            tagId: record.tagId,
                            bankName: record.bankName,
                            merchantCode: record.merchantCode,
                            commissionRate: record.commissionRate,
                            bankGlCode: record.bankGlCode,
                            isActive: record.isActive ?? true,
                            ...(locationIds?.length ? {
                                locations: {
                                    create: locationIds.map((locId) => ({ locationId: locId })),
                                },
                            } : {}),
                        },
                    });
                    created++;
                }
            }

            runInBackground(
                'Bulk Upsert Merchant Configs',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'create',
                    module: 'pos-config',
                    entity: 'MerchantConfig',
                    description: `Bulk upserted ${created} created, ${updated} updated merchant configs`,
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return { status: true, data: { created, updated, total: created + updated } };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }
}
