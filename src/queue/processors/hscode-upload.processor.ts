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
        this.logger.log(`[Job ${job.id}] Connected to tenant DB: ${tenantId}`);

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

            // Parsing
            this.eventsService.emit({ uploadId, type: 'status', data: { message: 'Parsing HS Code records...' } });
            await job.progress(5);
            const records = await this.csvParser.parseFile(fileBuffer, filename);
            await job.progress(15);

            if (records.length === 0) {
                throw new Error('No valid HS Code records found in file');
            }

            this.logger.log(`[Job ${job.id}] Parsed ${records.length} HS Code records`);

            await prisma.bulkUpload.update({
                where: { id: uploadId },
                data: { totalRecords: records.length },
            });

            this.eventsService.emit({
                uploadId,
                type: 'progress',
                data: { progress: 15, totalRecords: records.length, processedRecords: 0 }
            });

            let allValidationErrors: any[] = [];

            if (mode === 'import') {
                const uploadRecord = await prisma.bulkUpload.findUnique({
                    where: { id: uploadId },
                    select: { errors: true }
                });
                if (uploadRecord && uploadRecord.errors) {
                    allValidationErrors = (Array.isArray(uploadRecord.errors) ? uploadRecord.errors : []) as any[];
                    this.logger.log(`[Job ${job.id}] Skipping validation in import mode. Loaded ${allValidationErrors.length} known errors.`);
                }
            } else {
                // Validation (only run in validate mode)
                this.eventsService.emit({ uploadId, type: 'status', data: { message: `Scanning ${records.length} HS Code records...` } });
                await job.progress(20);

                const validationErrors = await this.validator.validateRecords(records);
                await job.progress(40);

                const duplicateHsCodeErrors = this.validator.checkDuplicateHsCodes(records);
                await job.progress(50);

                allValidationErrors = [
                    ...validationErrors,
                    ...duplicateHsCodeErrors,
                ];
            }

            const invalidRows = new Set(allValidationErrors.map(e => e.row));
            const validRecords = records.filter(r => !invalidRows.has(r.row));

            this.logger.log(`[Job ${job.id}] Validation result: ${validRecords.length} valid, ${allValidationErrors.length} invalid`);

            const progress: HsCodeUploadProgress = {
                totalRecords: records.length,
                processedRecords: 0,
                successRecords: 0,
                failedRecords: allValidationErrors.length,
                skippedRecords: 0,
                errors: allValidationErrors.map(e => ({
                    row: e.row,
                    reason: `${e.field}: ${e.reason}`,
                    data: { field: e.field, value: e.value },
                })),
            };

            if (mode === 'validate') {
                // Just save validation results
                await prisma.bulkUpload.update({
                    where: { id: uploadId },
                    data: {
                        status: 'validated',
                        totalRecords: records.length,
                        failedRecords: allValidationErrors.length,
                        successRecords: validRecords.length,
                        errors: progress.errors as any,
                        message: `HS Code validation complete: ${validRecords.length} valid, ${allValidationErrors.length} invalid.`,
                        completedAt: new Date(),
                    },
                });

                await this.notificationsService.create({
                    userId,
                    title: 'HS Code Validation Completed',
                    message: `HS Code bulk validation finished: ${validRecords.length} valid rows, ${allValidationErrors.length} invalid.`,
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
                        totalRecords: records.length,
                        successRecords: validRecords.length,
                        failedRecords: allValidationErrors.length,
                        errors: progress.errors,
                        progress: 100
                    }
                });
                return;
            }

            // Mode is 'import'
            this.logger.log(`[Job ${job.id}] Importing ${validRecords.length} HS Codes`);
            const batchSize = 50; // Smaller batches for HS Codes

            for (let i = 0; i < validRecords.length; i += batchSize) {
                const batch = validRecords.slice(i, i + batchSize);
                await this.processBatch(batch, progress, uploadId, prisma);

                await prisma.bulkUpload.update({
                    where: { id: uploadId },
                    data: {
                        processedRecords: progress.processedRecords,
                        successRecords: progress.successRecords,
                        failedRecords: progress.failedRecords,
                        message: `Importing: ${progress.processedRecords} of ${validRecords.length} HS Codes...`,
                    },
                });

                const currentProgress = Math.round((progress.processedRecords / validRecords.length) * 100);
                await job.progress(currentProgress);

                this.eventsService.emit({
                    uploadId,
                    type: 'progress',
                    data: {
                        progress: currentProgress,
                        processedRecords: progress.processedRecords,
                        successRecords: progress.successRecords,
                        failedRecords: progress.failedRecords,
                        status: 'processing'
                    }
                });
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

            this.logger.log(`[Job ${job.id}] HS Code Import COMPLETED: ${progress.successRecords} success, ${progress.failedRecords} failed`);

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
        } finally {
            if (prisma) await prisma.$disconnect();
        }
    }

    /**
     * Process a batch of HS Code records with individual error isolation
     */
    private async processBatch(batch: HsCodeParsedRecord[], progress: HsCodeUploadProgress, uploadId: string, prisma: PrismaService): Promise<void> {
        for (const record of batch) {
            try {
                // Individual record processing wrapped in try-catch
                await this.processRecord(record, prisma);
                progress.successRecords++;
            } catch (error) {
                // Log error but continue processing
                this.logger.warn(`Failed to process HS Code row ${record.row}: ${error.message}`);
                progress.failedRecords++;
                progress.errors.push({
                    row: record.row,
                    reason: error.message,
                    data: record.data,
                });
            }

            progress.processedRecords++;
        }
    }

    private async processRecord(record: HsCodeParsedRecord, prisma: PrismaService): Promise<void> {
        const { data } = record;

        // Check if HS Code already exists
        const existing = await prisma.hsCode.findFirst({
            where: {
                hsCode: String(data.hsCode),
            },
        });

        if (existing) {
            throw new Error(`HS Code "${data.hsCode}" already exists`);
        }

        // Create HS Code record
        await prisma.hsCode.create({
            data: {
                hsCode: String(data.hsCode),
                customsDutyCd: data.customsDutyCd || 0,
                regulatoryDutyRd: data.regulatoryDutyRd || 0,
                additionalCustomsDutyAcd: data.additionalCustomsDutyAcd || 0,
                salesTax: data.salesTax || 0,
                additionalSalesTax: 0, // Not in upload data
                incomeTax: data.incomeTax || 0,
                exciseCharges: 0, // Not in upload data
                status: 'active',
            },
        });
    }
}