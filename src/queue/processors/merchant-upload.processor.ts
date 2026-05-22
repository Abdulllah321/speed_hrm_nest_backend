import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { MerchantCsvParserService, MerchantParsedRecord } from '../../common/services/merchant-csv-parser.service';
import { MerchantValidatorService } from '../../common/services/merchant-validator.service';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { NotificationsService } from '../../notifications/notifications.service';
import * as fs from 'fs';
import * as path from 'path';

export interface MerchantUploadJobData {
    uploadId: string;
    fileBuffer?: Buffer;
    filename: string;
    userId: string;
    tenantId: string;
    tenantDbUrl: string;
    mode: 'validate' | 'import';
    uploadType: 'merchant';
}

export interface MerchantUploadProgress {
    totalRecords: number;
    processedRecords: number;
    successRecords: number;
    failedRecords: number;
    skippedRecords: number;
    errors: Array<{ row: number; reason: string; data: any }>;
}

@Processor('merchant-upload')
export class MerchantUploadProcessor {
    private readonly logger = new Logger(MerchantUploadProcessor.name);

    constructor(
        private readonly csvParser: MerchantCsvParserService,
        private readonly validator: MerchantValidatorService,
        private readonly eventsService: UploadEventsService,
        private readonly notificationsService: NotificationsService,
    ) { }

    @Process()
    async handleUpload(job: Job<any>): Promise<void> {
        let { uploadId, fileBuffer, filename, userId, tenantId, tenantDbUrl, mode } = job.data;
        mode = mode || 'import';

        this.logger.log(`[Job ${job.id}] Merchant ${mode.toUpperCase()} started for ${filename} (Upload ID: ${uploadId})`);

        // Reconstruct Buffer if serialized through Redis
        if (fileBuffer && (fileBuffer as any).type === 'Buffer' && Array.isArray((fileBuffer as any).data)) {
            fileBuffer = Buffer.from((fileBuffer as any).data);
        }

        // Recover from disk if missing (import phase)
        if (!fileBuffer) {
            const ext = filename.split('.').pop();
            const filePath = path.join(process.cwd(), 'uploads', 'bulk', 'merchant', `merchant-upload-${uploadId}.${ext}`);
            if (fs.existsSync(filePath)) {
                this.logger.log(`[Job ${job.id}] Recovering file from disk: ${filePath}`);
                fileBuffer = fs.readFileSync(filePath);
            } else {
                this.logger.error(`[Job ${job.id}] CRITICAL: File buffer missing and not found on disk at ${filePath}`);
                throw new Error(`File buffer missing and could not be found on disk at ${filePath}`);
            }
        }

        const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

        try {
            await prisma.bulkUpload.update({
                where: { id: uploadId },
                data: { status: mode === 'validate' ? 'validating' : 'processing' },
            });

            this.eventsService.emit({
                uploadId,
                type: 'status',
                data: {
                    status: mode === 'validate' ? 'validating' : 'processing',
                    message: mode === 'validate' ? 'Starting Merchant validation...' : 'Starting Merchant import...',
                },
            });

            const progress: MerchantUploadProgress = {
                totalRecords: 0,
                processedRecords: 0,
                successRecords: 0,
                failedRecords: 0,
                skippedRecords: 0,
                errors: [],
            };

            let totalRecordsCount = 0;
            let successRecordsCount = 0;
            let lastEmitTime = Date.now();

            // Fetch active locations and chart of accounts for validation
            const activeLocations = await prisma.location.findMany({
                where: { status: 'active' },
                select: { id: true, code: true },
            });
            const locationCodes = new Set(activeLocations.map(l => l.code.trim().toUpperCase()));
            const locationMap = new Map<string, string>(); // map code -> id
            for (const loc of activeLocations) {
                locationMap.set(loc.code.trim().toUpperCase(), loc.id);
            }

            const activeCoas = await prisma.chartOfAccount.findMany({
                where: { isActive: true, isGroup: false },
                select: { code: true },
            });
            const coaCodes = new Set(activeCoas.map(c => c.code.trim()));

            // ─────────────────────────────────────────────────────────────
            // IMPORT PHASE
            // ─────────────────────────────────────────────────────────────
            if (mode === 'import') {
                this.logger.log(`[Job ${job.id}] Starting Streaming Merchant Import for ${uploadId}`);

                const uploadRecord = await prisma.bulkUpload.findUnique({
                    where: { id: uploadId },
                    select: { errors: true, totalRecords: true },
                });

                const allValidationErrors = (Array.isArray(uploadRecord?.errors) ? uploadRecord.errors : []) as any[];
                const invalidRows = new Set(allValidationErrors.map(e => e.row));
                const totalToBeProcessed = (uploadRecord?.totalRecords || 0) - invalidRows.size;

                progress.totalRecords = uploadRecord?.totalRecords || 0;
                progress.failedRecords = invalidRows.size;
                progress.errors = allValidationErrors.map(e => ({
                    row: e.row,
                    reason: `${e.field}: ${e.reason}`,
                    data: { field: e.field, value: e.value },
                }));

                const startTime = Date.now();
                let importBatch: MerchantParsedRecord[] = [];

                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record) => {
                    totalRecordsCount++;
                    if (invalidRows.has(record.row)) return;

                    importBatch.push(record);

                    if (importBatch.length >= 500) {
                        await this.processBatch(importBatch, progress, locationMap, prisma);
                        importBatch = [];

                        await new Promise(resolve => setImmediate(resolve));

                        const now = Date.now();
                        if (now - lastEmitTime > 100) {
                            lastEmitTime = now;
                            const elapsedSec = (now - startTime) / 1000;
                            const recsPerSec = Math.round(progress.processedRecords / (elapsedSec || 1));
                            const memoryUsageMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
                            const currentProgress = totalToBeProcessed > 0
                                ? Math.round((progress.processedRecords / totalToBeProcessed) * 100)
                                : 0;

                            if (now % 5000 < 100) {
                                await prisma.bulkUpload.update({
                                    where: { id: uploadId },
                                    data: {
                                        processedRecords: progress.processedRecords,
                                        successRecords: progress.successRecords,
                                        failedRecords: progress.failedRecords,
                                        message: `Importing Merchants: ${progress.processedRecords} @ ${recsPerSec} recs/s`,
                                    },
                                });
                            }

                            await job.progress(currentProgress);
                            this.eventsService.emit({
                                uploadId,
                                type: 'progress',
                                data: {
                                    progress: currentProgress,
                                    processedRecords: progress.processedRecords,
                                    successRecords: progress.successRecords,
                                    failedRecords: progress.failedRecords,
                                    recsPerSec,
                                    memoryUsageMB,
                                    status: 'processing',
                                },
                            });
                        }
                    }
                });

                // Final batch
                if (importBatch.length > 0) {
                    await this.processBatch(importBatch, progress, locationMap, prisma);
                }

            // ─────────────────────────────────────────────────────────────
            // VALIDATE PHASE
            // ─────────────────────────────────────────────────────────────
            } else {
                this.eventsService.emit({ uploadId, type: 'status', data: { message: 'Streaming Merchant validation scan...' } });

                let validationBatch: MerchantParsedRecord[] = [];
                const allValidationErrors: any[] = [];
                const seenKeys = new Set<string>();

                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record) => {
                    totalRecordsCount++;

                    validationBatch.push(record);

                    if (validationBatch.length >= 500) {
                        for (const rec of validationBatch) {
                            const result = this.validator.validateRecord(rec, locationCodes, coaCodes, seenKeys);
                            if (!result.isValid) {
                                allValidationErrors.push(...result.errors);
                            } else {
                                successRecordsCount++;
                            }
                        }
                        validationBatch = [];

                        const now = Date.now();
                        if (now - lastEmitTime > 2000) {
                            lastEmitTime = now;
                            await job.progress(10);
                            this.eventsService.emit({
                                uploadId,
                                type: 'progress',
                                data: { progress: 10, status: 'validating', message: `Validating Merchants: ${totalRecordsCount} rows scanned...` },
                            });
                        }
                    }
                });

                if (validationBatch.length > 0) {
                    for (const rec of validationBatch) {
                        const result = this.validator.validateRecord(rec, locationCodes, coaCodes, seenKeys);
                        if (!result.isValid) {
                            allValidationErrors.push(...result.errors);
                        } else {
                            successRecordsCount++;
                        }
                    }
                }

                await prisma.bulkUpload.update({
                    where: { id: uploadId },
                    data: {
                        status: 'validated',
                        totalRecords: totalRecordsCount,
                        failedRecords: allValidationErrors.length,
                        successRecords: successRecordsCount,
                        errors: allValidationErrors as any,
                        message: `Merchant validation complete: ${successRecordsCount} valid, ${allValidationErrors.length} invalid.`,
                        completedAt: new Date(),
                    },
                });

                await this.notificationsService.create({
                    userId,
                    title: 'Merchant Validation Completed',
                    message: `Merchant bulk validation finished: ${successRecordsCount} valid rows, ${allValidationErrors.length} invalid.`,
                    category: 'system',
                    priority: 'normal',
                    channels: ['inApp'],
                });

                await job.progress(100);
                this.eventsService.emit({
                    uploadId,
                    type: 'completed',
                    data: {
                        status: 'validated',
                        totalRecords: totalRecordsCount,
                        successRecords: successRecordsCount,
                        failedRecords: allValidationErrors.length,
                        errors: allValidationErrors,
                        progress: 100,
                    },
                });
                return;
            }

            // ─────────────────────────────────────────────────────────────
            // Import complete
            // ─────────────────────────────────────────────────────────────
            await prisma.bulkUpload.update({
                where: { id: uploadId },
                data: {
                    status: 'completed',
                    message: `Merchant import completed: ${progress.successRecords} records added/updated.`,
                    completedAt: new Date(),
                },
            });

            await this.notificationsService.create({
                userId,
                title: 'Merchant Import Completed',
                message: `Merchant bulk import finished: ${progress.successRecords} added/updated, ${progress.failedRecords} failed.`,
                category: 'system',
                priority: 'high',
                channels: ['inApp'],
            });

            this.eventsService.emit({
                uploadId,
                type: 'completed',
                data: {
                    status: 'completed',
                    successRecords: progress.successRecords,
                    failedRecords: progress.failedRecords,
                    progress: 100,
                },
            });

        } catch (error) {
            this.logger.error(`[Job ${job.id}] FAILED: ${error.message}`, error.stack);
            try {
                await prisma.bulkUpload.update({
                    where: { id: uploadId },
                    data: { status: 'failed', completedAt: new Date(), message: `Error: ${error.message}` },
                });
                await this.notificationsService.create({
                    userId,
                    title: 'Merchant Bulk Job Failed',
                    message: `The Merchant ${mode} job failed: ${error.message}`,
                    category: 'system',
                    priority: 'urgent',
                    channels: ['inApp'],
                });
                this.eventsService.emit({ uploadId, type: 'failed', data: { message: error.message } });
            } catch (e) {
                this.logger.error(`Failed to update failure status: ${e.message}`);
            }
        } finally {
            await prisma.$disconnect();
        }
    }

    private async processBatch(
        batch: MerchantParsedRecord[],
        progress: MerchantUploadProgress,
        locationMap: Map<string, string>,
        prisma: PrismaService,
    ): Promise<void> {
        for (const record of batch) {
            const data = record.data;
            const tagId = (data.tagId || '').trim().toUpperCase();
            const merchantCode = this.validator.parseMerchantCode(data.merchantCode);
            const rate = this.validator.parseCommissionRate(data.commissionRateDecimal, data.commissionRatePercent);

            if (!tagId || merchantCode === null || rate === null) {
                progress.failedRecords++;
                progress.errors.push({
                    row: record.row,
                    reason: 'Crucial merchant config fields failed basic parsing during processing step',
                    data,
                });
                progress.processedRecords++;
                continue;
            }

            const locationId = locationMap.get(tagId);
            if (!locationId) {
                progress.failedRecords++;
                progress.errors.push({
                    row: record.row,
                    reason: `Resolved Location ID not found for Tag ID "${data.tagId}" during import`,
                    data,
                });
                progress.processedRecords++;
                continue;
            }

            try {
                // Upsert by tagId + merchantCode as natural key
                const existing = await prisma.merchantConfig.findFirst({
                    where: { tagId, merchantCode },
                });

                if (existing) {
                    await prisma.$transaction(async (tx) => {
                        await tx.merchantConfig.update({
                            where: { id: existing.id },
                            data: {
                                description: data.description || `${data.costCentre || tagId} | ${data.bank || ''}`,
                                costCentreTag: data.costCentre || tagId,
                                bankName: data.bank || '',
                                commissionRate: rate,
                                bankGlCode: data.bankGlCode || '',
                                isActive: true,
                            },
                        });

                        // Recreate locations junction
                        await tx.merchantConfigLocation.deleteMany({
                            where: { merchantConfigId: existing.id },
                        });

                        await tx.merchantConfigLocation.create({
                            data: {
                                merchantConfigId: existing.id,
                                locationId,
                            },
                        });
                    });
                } else {
                    await prisma.$transaction(async (tx) => {
                        const newConfig = await tx.merchantConfig.create({
                            data: {
                                tagId,
                                merchantCode,
                                description: data.description || `${data.costCentre || tagId} | ${data.bank || ''}`,
                                costCentreTag: data.costCentre || tagId,
                                bankName: data.bank || '',
                                commissionRate: rate,
                                bankGlCode: data.bankGlCode || '',
                                isActive: true,
                            },
                        });

                        await tx.merchantConfigLocation.create({
                            data: {
                                merchantConfigId: newConfig.id,
                                locationId,
                            },
                        });
                    });
                }

                progress.successRecords++;
            } catch (error) {
                this.logger.error(`Failed to import merchant config row ${record.row}: ${error.message}`);
                progress.failedRecords++;
                progress.errors.push({ row: record.row, reason: error.message, data });
            }

            progress.processedRecords++;
        }
    }
}
