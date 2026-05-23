import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { NotificationsService } from '../../notifications/notifications.service';
import * as fs from 'fs';
import * as path from 'path';

export interface BaseUploadProgress {
    totalRecords: number;
    processedRecords: number;
    successRecords: number;
    failedRecords: number;
    skippedRecords: number;
    errors: Array<{ row: number; reason: string; data: any }>;
}

export abstract class BaseUploadProcessor<TRecord = any> {
    protected readonly logger = new Logger(this.constructor.name);

    constructor(
        protected readonly csvParser: any,
        protected readonly validator: any,
        protected readonly eventsService: UploadEventsService,
        protected readonly notificationsService: NotificationsService,
        protected readonly uploadType: string,
    ) { }

    async handleUpload(job: Job<any>): Promise<void> {
        let { uploadId, fileBuffer, filename, userId, tenantId, tenantDbUrl, mode } = job.data;
        mode = mode || 'import';

        this.logger.log(`[Job ${job.id}] ${this.uploadType.toUpperCase()} ${mode.toUpperCase()} started for ${filename} (Upload ID: ${uploadId})`);

        // Reconstruct Buffer if serialised through Redis
        if (fileBuffer && (fileBuffer as any).type === 'Buffer' && Array.isArray((fileBuffer as any).data)) {
            fileBuffer = Buffer.from((fileBuffer as any).data);
        }

        // Recover from disk if missing (import phase)
        if (!fileBuffer) {
            const ext = filename.split('.').pop();
            const filePath = path.join(process.cwd(), 'uploads', 'bulk', this.uploadType, `${this.uploadType}-upload-${uploadId}.${ext}`);
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
                    message: mode === 'validate' ? `Starting ${this.uploadType} validation...` : `Starting ${this.uploadType} import...`,
                },
            });

            const progress: BaseUploadProgress = {
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
                this.logger.log(`[Job ${job.id}] Starting Streaming ${this.uploadType} Import for ${uploadId}`);

                const uploadRecord = await prisma.bulkUpload.findUnique({
                    where: { id: uploadId },
                    select: { errors: true, totalRecords: true },
                });

                const allValidationErrors = (Array.isArray(uploadRecord?.errors) ? uploadRecord.errors : []) as any[];
                const invalidRows = new Set<number>(allValidationErrors.map(e => e.row));
                const totalToBeProcessed = (uploadRecord?.totalRecords || 0) - invalidRows.size;

                progress.totalRecords = uploadRecord?.totalRecords || 0;
                progress.failedRecords = invalidRows.size;
                progress.errors = allValidationErrors.map(e => ({
                    row: e.row,
                    reason: e.reason || `${e.field}: ${e.reason}`,
                    data: { field: e.field || e.data?.field, value: e.value || e.data?.value },
                }));

                const startTime = Date.now();
                let importBatch: TRecord[] = [];

                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record: any) => {
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
                                ? Math.min(Math.round((progress.processedRecords / totalToBeProcessed) * 100), 99)
                                : 0;

                            if (now % 5000 < 100) {
                                await prisma.bulkUpload.update({
                                    where: { id: uploadId },
                                    data: {
                                        processedRecords: progress.processedRecords,
                                        successRecords: progress.successRecords,
                                        failedRecords: progress.failedRecords,
                                        message: `Importing ${this.uploadType}: ${progress.processedRecords} @ ${recsPerSec} recs/s`,
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
                this.eventsService.emit({ uploadId, type: 'status', data: { message: `Streaming ${this.uploadType} validation scan...` } });

                let validationBatch: TRecord[] = [];
                const allValidationErrors: any[] = [];

                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record: any) => {
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
                                data: { progress: 10, status: 'validating', message: `Validating ${this.uploadType}: ${totalRecordsCount} rows scanned...` },
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
                        message: `${this.uploadType} validation complete: ${successRecordsCount} valid, ${allValidationErrors.length} invalid.`,
                        completedAt: new Date(),
                    },
                });

                await this.notificationsService.create({
                    userId,
                    title: `${this.uploadType} Validation Completed`,
                    message: `${this.uploadType} bulk validation finished: ${successRecordsCount} valid rows, ${allValidationErrors.length} invalid.`,
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
                    processedRecords: progress.processedRecords,
                    successRecords: progress.successRecords,
                    failedRecords: progress.failedRecords,
                    message: `${this.uploadType} import completed: ${progress.successRecords} records added.`,
                    completedAt: new Date(),
                },
            });

            await this.notificationsService.create({
                userId,
                title: `${this.uploadType} Import Completed`,
                message: `${this.uploadType} bulk import finished: ${progress.successRecords} added, ${progress.failedRecords} failed.`,
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
                    title: `${this.uploadType} Bulk Job Failed`,
                    message: `The ${this.uploadType} ${mode} job failed: ${error.message}`,
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

    protected abstract processBatch(
        batch: TRecord[],
        progress: BaseUploadProgress,
        prisma: PrismaService,
    ): Promise<void>;
}
