import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { CustomerCsvParserService, CustomerParsedRecord } from '../../common/services/customer-csv-parser.service';
import { CustomerValidatorService } from '../../common/services/customer-validator.service';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { NotificationsService } from '../../notifications/notifications.service';
import * as fs from 'fs';
import * as path from 'path';

interface CustomerUploadProgress {
    totalRecords: number;
    processedRecords: number;
    successRecords: number;
    failedRecords: number;
    skippedRecords: number;
    errors: Array<{ row: number; reason: string; data: any }>;
}

@Processor('customer-upload')
export class CustomerUploadProcessor {
    private readonly logger = new Logger(CustomerUploadProcessor.name);

    constructor(
        private readonly csvParser: CustomerCsvParserService,
        private readonly validator: CustomerValidatorService,
        private readonly eventsService: UploadEventsService,
        private readonly notificationsService: NotificationsService,
    ) { }

    @Process()
    async handleUpload(job: Job<any>): Promise<void> {
        let { uploadId, fileBuffer, filename, userId, tenantId, tenantDbUrl, mode } = job.data;
        mode = mode || 'import';

        this.logger.log(`[Job ${job.id}] Customer ${mode.toUpperCase()} for ${filename} (Upload: ${uploadId})`);

        // Reconstruct Buffer if serialized
        if (fileBuffer && (fileBuffer as any).type === 'Buffer' && Array.isArray((fileBuffer as any).data)) {
            fileBuffer = Buffer.from((fileBuffer as any).data);
        }

        // Recover from disk if missing (import phase)
        if (!fileBuffer) {
            const ext = filename.split('.').pop();
            const filePath = path.join(process.cwd(), 'uploads', 'bulk', 'customer', `customer-upload-${uploadId}.${ext}`);
            if (fs.existsSync(filePath)) {
                fileBuffer = fs.readFileSync(filePath);
            } else {
                throw new Error(`File not found on disk at ${filePath}`);
            }
        }

        const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

        try {
            await prisma.bulkUpload.update({
                where: { id: uploadId },
                data: { status: mode === 'validate' ? 'validating' : 'processing' },
            });

            this.eventsService.emit({
                uploadId, type: 'status',
                data: { status: mode === 'validate' ? 'validating' : 'processing', message: mode === 'validate' ? 'Starting Customer Validation...' : 'Starting Customer Import...' }
            });

            const progress: CustomerUploadProgress = {
                totalRecords: 0, processedRecords: 0,
                successRecords: 0, failedRecords: 0, skippedRecords: 0, errors: [],
            };

            let totalRecordsCount = 0;
            let successRecordsCount = 0;
            let lastEmitTime = Date.now();
            const codeSet = new Set<string>();

            if (mode === 'import') {
                const uploadRecord = await prisma.bulkUpload.findUnique({
                    where: { id: uploadId },
                    select: { errors: true, totalRecords: true },
                });

                const allValidationErrors = (Array.isArray(uploadRecord?.errors) ? uploadRecord.errors : []) as any[];
                const invalidRows = new Set(allValidationErrors.map((e: any) => e.row));
                const totalToBeProcessed = (uploadRecord?.totalRecords || 0) - invalidRows.size;

                progress.totalRecords = uploadRecord?.totalRecords || 0;
                progress.failedRecords = invalidRows.size;
                progress.errors = allValidationErrors.map((e: any) => ({
                    row: e.row, reason: `${e.field}: ${e.reason}`, data: { field: e.field, value: e.value },
                }));

                const startTime = Date.now();
                let importBatch: CustomerParsedRecord[] = [];

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
                            const currentProgress = totalToBeProcessed > 0 ? Math.round((progress.processedRecords / totalToBeProcessed) * 100) : 0;

                            await job.progress(currentProgress);
                            this.eventsService.emit({
                                uploadId, type: 'progress',
                                data: { progress: currentProgress, processedRecords: progress.processedRecords, successRecords: progress.successRecords, failedRecords: progress.failedRecords, recsPerSec, memoryUsageMB, status: 'processing' }
                            });
                        }
                    }
                });

                if (importBatch.length > 0) await this.processBatch(importBatch, progress, prisma);

            } else {
                // Validation mode
                this.eventsService.emit({ uploadId, type: 'status', data: { message: 'Streaming customer validation...' } });

                let validationBatch: CustomerParsedRecord[] = [];
                const allValidationErrors: any[] = [];

                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record) => {
                    totalRecordsCount++;

                    // Duplicate code check within file
                    if (record.data.code) {
                        const normalized = String(record.data.code).trim().toLowerCase();
                        if (codeSet.has(normalized)) {
                            allValidationErrors.push({ row: record.row, field: 'code', value: record.data.code, reason: 'Duplicate Customer Code within file.' });
                        } else {
                            codeSet.add(normalized);
                        }
                    }

                    validationBatch.push(record);

                    if (validationBatch.length >= 500) {
                        const batchErrors = this.validator.validateRecords(validationBatch);
                        allValidationErrors.push(...batchErrors);
                        successRecordsCount += validationBatch.length - batchErrors.length;
                        validationBatch = [];

                        const now = Date.now();
                        if (now - lastEmitTime > 2000) {
                            lastEmitTime = now;
                            await job.progress(10);
                            this.eventsService.emit({ uploadId, type: 'progress', data: { progress: 10, status: 'validating', message: `Validating: ${totalRecordsCount} rows scanned...` } });
                        }
                    }
                });

                if (validationBatch.length > 0) {
                    const batchErrors = this.validator.validateRecords(validationBatch);
                    allValidationErrors.push(...batchErrors);
                    successRecordsCount += validationBatch.length - batchErrors.length;
                }

                codeSet.clear();

                await prisma.bulkUpload.update({
                    where: { id: uploadId },
                    data: {
                        status: 'validated',
                        totalRecords: totalRecordsCount,
                        failedRecords: allValidationErrors.length,
                        successRecords: successRecordsCount,
                        errors: allValidationErrors as any,
                        message: `Validation complete: ${successRecordsCount} valid, ${allValidationErrors.length} invalid.`,
                        completedAt: new Date(),
                    },
                });

                await this.notificationsService.create({
                    userId, title: 'Customer Validation Completed',
                    message: `Customer bulk validation finished: ${successRecordsCount} valid, ${allValidationErrors.length} invalid.`,
                    category: 'system', priority: 'normal', channels: ['inApp'],
                });

                await job.progress(100);
                this.eventsService.emit({
                    uploadId, type: 'completed',
                    data: { status: 'validated', totalRecords: totalRecordsCount, successRecords: successRecordsCount, failedRecords: allValidationErrors.length, errors: allValidationErrors, progress: 100 }
                });
                return;
            }

            await prisma.bulkUpload.update({
                where: { id: uploadId },
                data: { status: 'completed', message: `Import completed: ${progress.successRecords} customers added.`, completedAt: new Date() },
            });

            await this.notificationsService.create({
                userId, title: 'Customer Import Completed',
                message: `Customer bulk import finished: ${progress.successRecords} added, ${progress.failedRecords} failed.`,
                category: 'system', priority: 'high', channels: ['inApp'],
            });

            this.eventsService.emit({
                uploadId, type: 'completed',
                data: { status: 'completed', successRecords: progress.successRecords, failedRecords: progress.failedRecords, progress: 100 }
            });

        } catch (error) {
            this.logger.error(`[Job ${job.id}] FAILED: ${error.message}`, error.stack);
            try {
                await prisma.bulkUpload.update({
                    where: { id: uploadId },
                    data: { status: 'failed', completedAt: new Date(), message: `Error: ${error.message}` },
                });
                await this.notificationsService.create({
                    userId, title: 'Customer Bulk Job Failed',
                    message: `Customer ${mode} job failed: ${error.message}`,
                    category: 'system', priority: 'urgent', channels: ['inApp'],
                });
                this.eventsService.emit({ uploadId, type: 'failed', data: { message: error.message } });
            } catch (e) {
                this.logger.error(`Failed to update failure status: ${e.message}`);
            }
        } finally {
            await prisma.$disconnect();
        }
    }

    private async processBatch(batch: CustomerParsedRecord[], progress: CustomerUploadProgress, prisma: PrismaService): Promise<void> {
        const codes = batch.map(r => String(r.data.code)).filter(Boolean);
        const existing = await prisma.customer.findMany({
            where: { code: { in: codes } },
            select: { code: true },
        });
        const existingSet = new Set(existing.map(c => c.code));

        const toCreate: any[] = [];

        for (const record of batch) {
            const code = String(record.data.code);
            if (existingSet.has(code)) {
                // Update existing customer
                try {
                    await prisma.customer.update({
                        where: { code },
                        data: {
                            name: record.data.name || '',
                            address: record.data.address || null,
                            contactNo: record.data.contactNo || null,
                            email: record.data.email || null,
                        },
                    });
                    progress.successRecords++;
                } catch {
                    progress.failedRecords++;
                }
            } else {
                toCreate.push({
                    code,
                    name: record.data.name || '',
                    address: record.data.address || null,
                    contactNo: record.data.contactNo || null,
                    email: record.data.email || null,
                });
            }
            progress.processedRecords++;
        }

        if (toCreate.length > 0) {
            try {
                await prisma.customer.createMany({ data: toCreate, skipDuplicates: true });
                progress.successRecords += toCreate.length;
            } catch (error) {
                this.logger.error(`Bulk create failed: ${error.message}`);
                for (const item of toCreate) {
                    try {
                        await prisma.customer.create({ data: item });
                        progress.successRecords++;
                    } catch {
                        progress.failedRecords++;
                    }
                }
            }
        }
    }
}
