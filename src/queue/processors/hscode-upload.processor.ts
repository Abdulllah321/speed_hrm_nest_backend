import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { HsCodeCsvParserService, HsCodeParsedRecord } from '../../common/services/hscode-csv-parser.service';
import { HsCodeValidatorService, HsCodeValidationError } from '../../common/services/hscode-validator.service';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { NotificationsService } from '../../notifications/notifications.service';
import * as fs from 'fs';
import * as path from 'path';

export interface HsCodeUploadJobData {
    uploadId: string;
    fileBuffer: Buffer;
    filename: string;
    userId: string;
    tenantId: string;
    tenantDbUrl: string;
    uploadType: 'hscode';
}

export interface HsCodeUploadProgress {
    totalRecords: number;
    processedRecords: number;
    successRecords: number;
    failedRecords: number;
    skippedRecords: number;
    recsPerSec?: number;
    memoryUsageMB?: number;
    errors: Array<{
        row: number;
        reason: string;
        data: any;
    }>;
}

@Processor('hscode-upload')
export class HsCodeUploadProcessor {
    private readonly logger = new Logger(HsCodeUploadProcessor.name);

    constructor(
        private readonly csvParser: HsCodeCsvParserService,
        private readonly validator: HsCodeValidatorService,
        private readonly eventsService: UploadEventsService,
        private readonly notificationsService: NotificationsService,
    ) { }

    @Process()
    async handleUpload(job: Job<any>): Promise<void> {
        let { uploadId, fileBuffer, filename, userId, tenantId, tenantDbUrl, mode } = job.data;
        mode = mode || 'import';

        this.logger.log(`[Job ${job.id}] HS Code ${mode.toUpperCase()} phase started for ${filename} (Upload ID: ${uploadId})`);

        // Reconstruct Buffer if provided (validation phase)
        if (fileBuffer && (fileBuffer as any).type === 'Buffer' && Array.isArray((fileBuffer as any).data)) {
            fileBuffer = Buffer.from((fileBuffer as any).data);
        }

        // Recover from disk if missing (import phase)
        if (!fileBuffer) {
            const ext = filename.split('.').pop();
            const filePath = path.join(process.cwd(), 'uploads', 'bulk', 'hscode', `hscode-upload-${uploadId}.${ext}`);
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
                data: { status: mode === 'validate' ? 'validating' : 'processing', message: mode === 'validate' ? 'Starting HS Code Validation...' : 'Starting HS Code Import...' }
            });

            const progress: HsCodeUploadProgress = {
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
            const hsCodeSet = new Set<string>(); // For duplicate detection in memory

            if (mode === 'import') {
                // Stage 2: Streaming Batch Import
                this.logger.log(`[Job ${job.id}] Starting Streaming HS Code Import for ${uploadId}`);
                
                // Load existing validation errors from DB to know which rows to skip
                const uploadRecord = await prisma.bulkUpload.findUnique({
                    where: { id: uploadId },
                    select: { errors: true, totalRecords: true }
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
                let importBatch: HsCodeParsedRecord[] = [];
                
                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record) => {
                    totalRecordsCount++;
                    if (invalidRows.has(record.row)) return;

                    importBatch.push(record);

                    if (importBatch.length >= 1000) {
                        await this.processBatch(importBatch, progress, uploadId, prisma);
                        importBatch = []; // Clear memory

                        // Yield to event loop
                        await new Promise(resolve => setImmediate(resolve));

                        // Throttled Progress Update (10Hz / 100ms)
                        const now = Date.now();
                        if (now - lastEmitTime > 100) {
                            lastEmitTime = now;
                            const elapsedSec = (now - startTime) / 1000;
                            const recsPerSec = Math.round(progress.processedRecords / (elapsedSec || 1));
                            const memoryUsageMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
                            const currentProgress = totalToBeProcessed > 0 ? Math.round((progress.processedRecords / totalToBeProcessed) * 100) : 0;
                            
                            if (now % 5000 < 100) {
                                await prisma.bulkUpload.update({
                                    where: { id: uploadId },
                                    data: {
                                        processedRecords: progress.processedRecords,
                                        successRecords: progress.successRecords,
                                        failedRecords: progress.failedRecords,
                                        message: `Importing HS Codes: ${progress.processedRecords} @ ${recsPerSec} recs/s (Mem: ${memoryUsageMB}MB)`,
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
                                    status: 'processing'
                                }
                            });
                        }
                    }
                });

                // Final small batch
                if (importBatch.length > 0) {
                    await this.processBatch(importBatch, progress, uploadId, prisma);
                }
            } else {
                // Stage 1: Validation Mode - Truly Streaming
                this.eventsService.emit({ uploadId, type: 'status', data: { message: 'Streaming HS Code validation scan...' } });

                let validationBatch: HsCodeParsedRecord[] = [];
                const allValidationErrors: any[] = [];

                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record) => {
                    totalRecordsCount++;
                    
                    // Track duplicates in memory (lightweight compared to full records)
                    if (record.data.hsCode) {
                        const normalized = String(record.data.hsCode).trim().toLowerCase();
                        if (hsCodeSet.has(normalized)) {
                            allValidationErrors.push({
                                row: record.row,
                                field: 'HSCode',
                                value: record.data.hsCode,
                                reason: 'Duplicate HS Code found within file.'
                            });
                        } else {
                            hsCodeSet.add(normalized);
                        }
                    }

                    validationBatch.push(record);

                    if (validationBatch.length >= 1000) {
                        const batchErrors = await this.validator.validateRecords(validationBatch);
                        allValidationErrors.push(...batchErrors);
                        successRecordsCount += (validationBatch.length - batchErrors.length);
                        validationBatch = []; // Clear memory

                        // Throttled Progress
                        const now = Date.now();
                        if (now - lastEmitTime > 2000) {
                            lastEmitTime = now;
                            await job.progress(10);
                            this.eventsService.emit({
                                uploadId,
                                type: 'progress',
                                data: { progress: 10, status: 'validating', message: `Validating HS Codes: ${totalRecordsCount} rows scanned...` }
                            });
                        }
                    }
                });

                if (validationBatch.length > 0) {
                    const batchErrors = await this.validator.validateRecords(validationBatch);
                    allValidationErrors.push(...batchErrors);
                    successRecordsCount += (validationBatch.length - batchErrors.length);
                }
                
                hsCodeSet.clear(); // Free memory

                // Update DB with validation results
                await prisma.bulkUpload.update({
                    where: { id: uploadId },
                    data: {
                        status: 'validated',
                        totalRecords: totalRecordsCount,
                        failedRecords: allValidationErrors.length,
                        successRecords: successRecordsCount,
                        errors: allValidationErrors as any,
                        message: `HS Code validation complete: ${successRecordsCount} valid, ${allValidationErrors.length} invalid.`,
                        completedAt: new Date(),
                    },
                });

                await this.notificationsService.create({
                    userId,
                    title: 'HS Code Validation Completed',
                    message: `HS Code bulk validation finished: ${successRecordsCount} valid rows, ${allValidationErrors.length} invalid.`,
                    category: 'system',
                    priority: 'normal',
                    channels: ['inApp']
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
                        progress: 100
                    }
                });
                return;
            }

            await prisma.bulkUpload.update({
                where: { id: uploadId },
                data: {
                    status: 'completed',
                    message: `HS Code import completed successfully: ${progress.successRecords} records added.`,
                    completedAt: new Date(),
                },
            });

            await this.notificationsService.create({
                userId,
                title: 'HS Code Import Completed',
                message: `HS Code bulk import finished: ${progress.successRecords} added, ${progress.failedRecords} failed.`,
                category: 'system',
                priority: 'high',
                channels: ['inApp']
            });

            this.eventsService.emit({
                uploadId,
                type: 'completed',
                data: {
                    status: 'completed',
                    successRecords: progress.successRecords,
                    failedRecords: progress.failedRecords,
                    progress: 100
                }
            });

        } catch (error) {
            this.logger.error(`[Job ${job.id}] FAILED: ${error.message}`, error.stack);
            try {
                await prisma.bulkUpload.update({
                    where: { id: uploadId },
                    data: {
                        status: 'failed',
                        completedAt: new Date(),
                        message: `Error: ${error.message}`,
                    },
                });

                await this.notificationsService.create({
                    userId,
                    title: 'HS Code Bulk Job Failed',
                    message: `The requested HS Code ${mode} job failed unexpectedly: ${error.message}`,
                    category: 'system',
                    priority: 'urgent',
                    channels: ['inApp']
                });

                this.eventsService.emit({ uploadId, type: 'failed', data: { message: error.message } });
            } catch (e) {
                this.logger.error(`Failed to update failure status in DB: ${e.message}`);
            }
        } finally {
            await prisma.$disconnect();
        }
    }

    /**
     * Process a batch of HS Code records with individual error isolation and bulk operations
     */
    private async processBatch(batch: HsCodeParsedRecord[], progress: HsCodeUploadProgress, uploadId: string, prisma: PrismaService): Promise<void> {
        // Bulk existence check for this batch
        const hsCodes = batch.map(r => String(r.data.hsCode)).filter(Boolean);
        const existingHsCodes = await prisma.hsCode.findMany({
            where: { hsCode: { in: hsCodes } },
            select: { hsCode: true }
        });
        const existingSet = new Set(existingHsCodes.map(i => i.hsCode));

        const toCreate: any[] = [];
        
        for (const record of batch) {
            const hsCode = String(record.data.hsCode);
            if (existingSet.has(hsCode)) {
                // Log warning for existing HS Code and count as skipped/failed
                this.logger.warn(`HS Code "${hsCode}" already exists at row ${record.row}. Skipping.`);
                progress.failedRecords++;
                progress.errors.push({
                    row: record.row,
                    reason: `HS Code "${hsCode}" already exists`,
                    data: record.data,
                });
            } else {
                toCreate.push({
                    hsCode: hsCode,
                    customsDutyCd: Number(record.data.customsDutyCd) || 0,
                    regulatoryDutyRd: Number(record.data.regulatoryDutyRd) || 0,
                    additionalCustomsDutyAcd: Number(record.data.additionalCustomsDutyAcd) || 0,
                    salesTax: Number(record.data.salesTax) || 0,
                    additionalSalesTax: 0,
                    incomeTax: Number(record.data.incomeTax) || 0,
                    exciseCharges: 0,
                    status: 'active',
                });
            }
            progress.processedRecords++;
        }

        // Execute Bulk Creation
        if (toCreate.length > 0) {
            try {
                await prisma.hsCode.createMany({
                    data: toCreate,
                    skipDuplicates: true
                });
                progress.successRecords += toCreate.length;
            } catch (error) {
                this.logger.error(`Bulk create of HS Codes failed: ${error.message}`);
                // Fallback to individual
                for (const item of toCreate) {
                    try {
                        await prisma.hsCode.create({ data: item });
                        progress.successRecords++;
                    } catch (e) {
                        progress.failedRecords++;
                    }
                }
            }
        }
    }
}
