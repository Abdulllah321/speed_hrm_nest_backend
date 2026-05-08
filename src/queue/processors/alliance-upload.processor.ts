import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { AllianceCsvParserService, AllianceParsedRecord } from '../../common/services/alliance-csv-parser.service';
import { AllianceValidatorService } from '../../common/services/alliance-validator.service';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { NotificationsService } from '../../notifications/notifications.service';
import * as fs from 'fs';
import * as path from 'path';

export interface AllianceUploadJobData {
    uploadId: string;
    fileBuffer?: Buffer;
    filename: string;
    userId: string;
    tenantId: string;
    tenantDbUrl: string;
    mode: 'validate' | 'import';
    uploadType: 'alliance';
}

export interface AllianceUploadProgress {
    totalRecords: number;
    processedRecords: number;
    successRecords: number;
    failedRecords: number;
    skippedRecords: number;
    errors: Array<{ row: number; reason: string; data: any }>;
}

@Processor('alliance-upload')
export class AllianceUploadProcessor {
    private readonly logger = new Logger(AllianceUploadProcessor.name);

    constructor(
        private readonly csvParser: AllianceCsvParserService,
        private readonly validator: AllianceValidatorService,
        private readonly eventsService: UploadEventsService,
        private readonly notificationsService: NotificationsService,
    ) { }

    @Process()
    async handleUpload(job: Job<any>): Promise<void> {
        let { uploadId, fileBuffer, filename, userId, tenantId, tenantDbUrl, mode } = job.data;
        mode = mode || 'import';

        this.logger.log(`[Job ${job.id}] Alliance ${mode.toUpperCase()} started for ${filename} (Upload ID: ${uploadId})`);

        // Reconstruct Buffer if serialised through Redis
        if (fileBuffer && (fileBuffer as any).type === 'Buffer' && Array.isArray((fileBuffer as any).data)) {
            fileBuffer = Buffer.from((fileBuffer as any).data);
        }

        // Recover from disk if missing (import phase)
        if (!fileBuffer) {
            const ext = filename.split('.').pop();
            const filePath = path.join(process.cwd(), 'uploads', 'bulk', 'alliance', `alliance-upload-${uploadId}.${ext}`);
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
                    message: mode === 'validate' ? 'Starting Alliance validation...' : 'Starting Alliance import...',
                },
            });

            const progress: AllianceUploadProgress = {
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

            // ─────────────────────────────────────────────────────────────
            // IMPORT PHASE
            // ─────────────────────────────────────────────────────────────
            if (mode === 'import') {
                this.logger.log(`[Job ${job.id}] Starting Streaming Alliance Import for ${uploadId}`);

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
                let importBatch: AllianceParsedRecord[] = [];

                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record) => {
                    totalRecordsCount++;
                    if (invalidRows.has(record.row)) return;

                    importBatch.push(record);

                    if (importBatch.length >= 500) {
                        await this.processBatch(importBatch, progress, prisma);
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
                                        message: `Importing Alliances: ${progress.processedRecords} @ ${recsPerSec} recs/s`,
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
                    await this.processBatch(importBatch, progress, prisma);
                }

            // ─────────────────────────────────────────────────────────────
            // VALIDATE PHASE
            // ─────────────────────────────────────────────────────────────
            } else {
                this.eventsService.emit({ uploadId, type: 'status', data: { message: 'Streaming Alliance validation scan...' } });

                let validationBatch: AllianceParsedRecord[] = [];
                const allValidationErrors: any[] = [];

                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record) => {
                    totalRecordsCount++;

                    validationBatch.push(record);

                    if (validationBatch.length >= 500) {
                        const batchErrors = this.validator.validateRecords(validationBatch);
                        allValidationErrors.push(...batchErrors);
                        successRecordsCount += (validationBatch.length - batchErrors.length);
                        validationBatch = [];

                        const now = Date.now();
                        if (now - lastEmitTime > 2000) {
                            lastEmitTime = now;
                            await job.progress(10);
                            this.eventsService.emit({
                                uploadId,
                                type: 'progress',
                                data: { progress: 10, status: 'validating', message: `Validating Alliances: ${totalRecordsCount} rows scanned...` },
                            });
                        }
                    }
                });

                if (validationBatch.length > 0) {
                    const batchErrors = this.validator.validateRecords(validationBatch);
                    allValidationErrors.push(...batchErrors);
                    successRecordsCount += (validationBatch.length - batchErrors.length);
                }

                await prisma.bulkUpload.update({
                    where: { id: uploadId },
                    data: {
                        status: 'validated',
                        totalRecords: totalRecordsCount,
                        failedRecords: allValidationErrors.length,
                        successRecords: successRecordsCount,
                        errors: allValidationErrors as any,
                        message: `Alliance validation complete: ${successRecordsCount} valid, ${allValidationErrors.length} invalid.`,
                        completedAt: new Date(),
                    },
                });

                await this.notificationsService.create({
                    userId,
                    title: 'Alliance Validation Completed',
                    message: `Alliance bulk validation finished: ${successRecordsCount} valid rows, ${allValidationErrors.length} invalid.`,
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
                    message: `Alliance import completed: ${progress.successRecords} records added.`,
                    completedAt: new Date(),
                },
            });

            await this.notificationsService.create({
                userId,
                title: 'Alliance Import Completed',
                message: `Alliance bulk import finished: ${progress.successRecords} added, ${progress.failedRecords} failed.`,
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
                    title: 'Alliance Bulk Job Failed',
                    message: `The Alliance ${mode} job failed: ${error.message}`,
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

    /**
     * Process a batch: group rows by alliance code, upsert the alliance, then
     * append the BIN to its binNumbers array.
     *
     * Template rows: one row per BIN. Multiple rows share the same alliance name
     * (and account code). We group them so we create/update the alliance once and
     * collect all BINs together.
     */
    private async processBatch(
        batch: AllianceParsedRecord[],
        progress: AllianceUploadProgress,
        prisma: PrismaService,
    ): Promise<void> {
        // Group rows by alliance name (case-insensitive) to collect all BINs
        const allianceMap = new Map<string, {
            records: AllianceParsedRecord[];
            bins: string[];
        }>();

        for (const record of batch) {
            const key = (record.data.allianceName || '').trim().toUpperCase();
            if (!key) {
                progress.failedRecords++;
                progress.errors.push({ row: record.row, reason: 'Alliance name is empty', data: record.data });
                progress.processedRecords++;
                continue;
            }

            const bin = this.validator.parseBin(record.data.binNumber || '');
            if (!bin) {
                progress.failedRecords++;
                progress.errors.push({ row: record.row, reason: `Invalid BIN: ${record.data.binNumber}`, data: record.data });
                progress.processedRecords++;
                continue;
            }

            if (!allianceMap.has(key)) {
                allianceMap.set(key, { records: [], bins: [] });
            }
            const entry = allianceMap.get(key)!;
            entry.records.push(record);
            if (!entry.bins.includes(bin)) entry.bins.push(bin);
            progress.processedRecords++;
        }

        // Upsert each alliance group
        for (const [allianceKey, { records, bins }] of allianceMap) {
            const representative = records[0];
            const data = representative.data;

            // Derive a short unique code from account code or alliance name
            const code = (data.accountCode || allianceKey)
                .toUpperCase()
                .replace(/[^A-Z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 30);

            const discountPercent = this.extractDiscountPercent(data.allianceName || '');
            const maxDiscount = this.validator.parseCapping(data.discountCapping || '');
            const endDate = this.validator.parseExpiry(data.expiry || '');

            try {
                // Check if alliance with this code already exists
                const existing = await prisma.allianceDiscount.findUnique({ where: { code } });

                if (existing) {
                    // Merge new BINs into existing array
                    const mergedBins = Array.from(new Set([...existing.binNumbers, ...bins]));
                    await prisma.allianceDiscount.update({
                        where: { code },
                        data: {
                            binNumbers: mergedBins,
                            ...(endDate && { endDate }),
                            ...(maxDiscount !== null && { maxDiscount }),
                        },
                    });
                } else {
                    await prisma.allianceDiscount.create({
                        data: {
                            partnerName: data.bank || data.allianceName || allianceKey,
                            code,
                            discountPercent: discountPercent ?? 0,
                            maxDiscount: maxDiscount ?? undefined,
                            description: data.allianceName || undefined,
                            endDate: endDate ?? undefined,
                            binNumbers: bins,
                            isActive: true,
                        },
                    });
                }
                progress.successRecords += records.length;
            } catch (error) {
                this.logger.error(`Failed to upsert alliance "${allianceKey}": ${error.message}`);
                progress.failedRecords += records.length;
                for (const r of records) {
                    progress.errors.push({ row: r.row, reason: error.message, data: r.data });
                }
            }
        }
    }

    /**
     * Extract discount percentage from alliance name string.
     * e.g. "HBL - 25% and Rs. 30,000 Capping" → 25
     */
    private extractDiscountPercent(name: string): number | null {
        const match = name.match(/(\d+(?:\.\d+)?)\s*%/);
        return match ? parseFloat(match[1]) : null;
    }
}
