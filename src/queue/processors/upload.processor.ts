import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { CsvParserService, ParsedRecord } from '../../common/services/csv-parser.service';
import { MasterDataService } from '../../common/services/master-data.service';
import { ItemValidatorService, ValidationError } from '../../common/services/item-validator.service';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { NotificationsService } from '../../notifications/notifications.service';
import * as fs from 'fs';
import * as path from 'path';

export interface UploadJobData {
    uploadId: string;
    fileBuffer: Buffer;
    filename: string;
    userId: string;
    tenantId: string;
    tenantDbUrl: string;
}

export interface UploadProgress {
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

@Processor('item-upload')
export class UploadProcessor {
    private readonly logger = new Logger(UploadProcessor.name);

    constructor(
        private readonly csvParser: CsvParserService,
        private readonly validator: ItemValidatorService,
        private readonly eventsService: UploadEventsService,
        private readonly notificationsService: NotificationsService,
    ) { }

    @Process()
    async handleUpload(job: Job<any>): Promise<void> {
        let { uploadId, fileBuffer, filename, userId, tenantId, tenantDbUrl, mode } = job.data;
        mode = mode || 'import';

        this.logger.log(`[Job ${job.id}] ${mode.toUpperCase()} phase started for ${filename} (Upload ID: ${uploadId})`);

        // Reconstruct Buffer if provided (validation phase)
        if (fileBuffer && (fileBuffer as any).type === 'Buffer' && Array.isArray((fileBuffer as any).data)) {
            fileBuffer = Buffer.from((fileBuffer as any).data);
        }

        // Recovery logic for large files from disk if buffer is missing
        if (!fileBuffer) {
            const ext = filename.split('.').pop();
            const filePath = path.join(process.cwd(), 'uploads', 'bulk', `upload-${uploadId}.${ext}`);
            if (fs.existsSync(filePath)) {
                this.logger.log(`[Job ${job.id}] Recovering file from disk: ${filePath}`);
                fileBuffer = fs.readFileSync(filePath);
            } else {
                this.logger.error(`[Job ${job.id}] CRITICAL: File buffer missing and not found on disk at ${filePath}`);
                throw new Error(`File buffer missing and could not be found on disk at ${filePath}`);
            }
        }

        const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
        const tenantMasterData = new MasterDataService(prisma);

        try {
            await prisma.bulkUpload.update({
                where: { id: uploadId },
                data: { status: mode === 'validate' ? 'validating' : 'processing' },
            });

            this.eventsService.emit({
                uploadId,
                type: 'status',
                data: { status: mode === 'validate' ? 'validating' : 'processing', message: mode === 'validate' ? 'Starting Validation...' : 'Starting Import...' }
            });

            const progress: UploadProgress = {
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
            const itemIdSet = new Set<string>(); // For duplicate detection (memory intensive but better than full records)

            if (mode === 'import') {
                // Stage 2: Streaming Batch Import
                this.logger.log(`[Job ${job.id}] Starting Streaming Import for ${uploadId}`);
                
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
                let importBatch: ParsedRecord[] = [];
                
                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record) => {
                    totalRecordsCount++;
                    if (invalidRows.has(record.row)) return;

                    importBatch.push(record);

                    if (importBatch.length >= 1000) {
                        await this.processBatch(importBatch, progress, uploadId, prisma, tenantMasterData);
                        importBatch = []; // Clear memory

                        // Yield to event loop to prevent blocking other requests
                        await new Promise(resolve => setImmediate(resolve));

                        // Throttled Progress Update (10Hz / 100ms for "highly realtime")
                        const now = Date.now();
                        if (now - lastEmitTime > 100) {
                            lastEmitTime = now;
                            const elapsedSec = (now - startTime) / 1000;
                            const recsPerSec = Math.round(progress.processedRecords / (elapsedSec || 1));
                            const memoryUsageMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
                            const currentProgress = totalToBeProcessed > 0 ? Math.round((progress.processedRecords / totalToBeProcessed) * 100) : 0;
                            
                            // Don't update DB on every 100ms (too much IO), update DB every 5 seconds
                            if (now % 5000 < 100) {
                                await prisma.bulkUpload.update({
                                    where: { id: uploadId },
                                    data: {
                                        processedRecords: progress.processedRecords,
                                        successRecords: progress.successRecords,
                                        failedRecords: progress.failedRecords,
                                        message: `Importing: ${progress.processedRecords} @ ${recsPerSec} recs/s (Mem: ${memoryUsageMB}MB)`,
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
                    await this.processBatch(importBatch, progress, uploadId, prisma, tenantMasterData);
                }
            } else {
                // Stage 1: Validation Mode - Truly Streaming
                this.eventsService.emit({ uploadId, type: 'status', data: { message: 'Streaming validation scan...' } });

                let validationBatch: ParsedRecord[] = [];
                const allValidationErrors: any[] = [];

                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record) => {
                    totalRecordsCount++;
                    
                    // Track duplicates in memory (lightweight compared to full records)
                    if (record.data.itemId) {
                        const normalized = String(record.data.itemId).trim().toLowerCase();
                        if (itemIdSet.has(normalized)) {
                            allValidationErrors.push({
                                row: record.row,
                                field: 'ItemID',
                                value: record.data.itemId,
                                reason: 'Duplicate ItemID found within file.'
                            });
                        } else {
                            itemIdSet.add(normalized);
                        }
                    }

                    // HS Code existence validation (No auto-creation during validation)
                    if (record.data.hsCode) {
                        const hsCode = String(record.data.hsCode).trim();
                        if (hsCode !== '') {
                            const hsCodeId = await tenantMasterData.findHsCode(hsCode);
                            if (!hsCodeId) {
                                allValidationErrors.push({
                                    row: record.row,
                                    field: 'HSCode',
                                    value: record.data.hsCode,
                                    reason: `HS Code '${record.data.hsCode}' not found in master data. Please create it first.`
                                });
                            }
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
                            await job.progress(10); // Still in phase 1
                            this.eventsService.emit({
                                uploadId,
                                type: 'progress',
                                data: { progress: 10, status: 'validating', message: `Validating: ${totalRecordsCount} rows scanned...` }
                            });
                        }
                    }
                });

                if (validationBatch.length > 0) {
                    const batchErrors = await this.validator.validateRecords(validationBatch);
                    allValidationErrors.push(...batchErrors);
                    successRecordsCount += (validationBatch.length - batchErrors.length);
                }
                
                itemIdSet.clear(); // Free memory

                // Update DB with validation results
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
                    userId,
                    title: 'Validation Completed',
                    message: `Bulk validation finished: ${successRecordsCount} valid rows, ${allValidationErrors.length} invalid.`,
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
                    message: `Import completed successfully: ${progress.successRecords} records added.`,
                    completedAt: new Date(),
                },
            });

            await this.notificationsService.create({
                userId,
                title: 'Import Completed',
                message: `Bulk import finished: ${progress.successRecords} added, ${progress.failedRecords} failed.`,
                category: 'system',
                priority: 'high',
                channels: ['inApp']
            });

            this.logger.log(`[Job ${job.id}] Import COMPLETED: ${progress.successRecords} success, ${progress.failedRecords} failed`);

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
                    title: 'Bulk Job Failed',
                    message: `The requested ${mode} job failed unexpectedly: ${error.message}`,
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
     * Process a batch of records with individual error isolation and bulk operations
     */
    private async processBatch(batch: ParsedRecord[], progress: UploadProgress, uploadId: string, prisma: PrismaService, tenantMasterData: MasterDataService): Promise<void> {
        // Bulk existence check
        const itemIds = batch.map(r => String(r.data.itemId)).filter(Boolean);
        const existingItems = await prisma.item.findMany({
            where: { itemId: { in: itemIds } },
            select: { id: true, itemId: true }
        });
        const existingMap = new Map(existingItems.map(i => [i.itemId, i.id]));

        const toCreate: any[] = [];
        const toUpdate: Array<{ id: string, data: any, row: number }> = [];

        for (const record of batch) {
            try {
                const itemData = await this.prepareItemData(record, tenantMasterData);
                const itemId = String(record.data.itemId);

                if (existingMap.has(itemId)) {
                    toUpdate.push({
                        id: existingMap.get(itemId) as string,
                        data: itemData,
                        row: record.row
                    });
                } else {
                    toCreate.push({
                        ...itemData,
                        itemId: itemId, // Required for creation
                    });
                }
            } catch (error) {
                this.logger.warn(`Failed to prepare row ${record.row}: ${error.message}`);
                progress.failedRecords++;
                progress.errors.push({
                    row: record.row,
                    reason: error.message,
                    data: record.data,
                });
                progress.processedRecords++;
            }
        }

        // Execute Bulk Creation
        if (toCreate.length > 0) {
            try {
                await prisma.item.createMany({
                    data: toCreate,
                    skipDuplicates: true
                });
                progress.successRecords += toCreate.length;
                progress.processedRecords += toCreate.length;
            } catch (error) {
                this.logger.error(`Bulk create failed, falling back to individual processing: ${error.message}`);
                // Fallback to individual for this specific subset if bulk fails (rare)
                for (const item of toCreate) {
                    try {
                        await prisma.item.create({ data: item });
                        progress.successRecords++;
                    } catch (e) {
                        progress.failedRecords++;
                    }
                    progress.processedRecords++;
                }
            }
        }

        // Execute Individual Updates (Prisma doesn't easily support batch upsert yet)
        for (const item of toUpdate) {
            try {
                await prisma.item.update({
                    where: { id: item.id },
                    data: item.data
                });
                progress.successRecords++;
            } catch (error) {
                this.logger.warn(`Failed to update row ${item.row}: ${error.message}`);
                progress.failedRecords++;
                progress.errors.push({
                    row: item.row,
                    reason: `Update failed: ${error.message}`,
                    data: { id: item.id }
                });
            }
            progress.processedRecords++;
        }
    }

    private async prepareItemData(record: ParsedRecord, tenantMasterData: MasterDataService): Promise<any> {
        const { data } = record;

        // Step 1: Resolve high-level master data (Sequentially to populate cache and avoid connection burst)
        const brandId = await tenantMasterData.getOrCreateBrand(data.concept as string);
        const itemClassId = await tenantMasterData.getOrCreateItemClass(data.class as string);
        const categoryId = await tenantMasterData.getOrCreateCategory(data.productCategory as string);
        const sizeId = await tenantMasterData.getOrCreateSize(data.size as string);
        const colorId = await tenantMasterData.getOrCreateColor(data.color as string);
        const genderId = await tenantMasterData.getOrCreateGender(data.gender as string);
        const silhouetteId = await tenantMasterData.getOrCreateSilhouette(data.silhouette as string);
        const channelClassId = await tenantMasterData.getOrCreateChannelClass(data.channelClass as string);
        const seasonId = await tenantMasterData.getOrCreateSeason(data.season as string);
        const segmentId = await tenantMasterData.getOrCreateSegment(data.segment as string);
        const hsCodeId = await tenantMasterData.getOrCreateHsCode(data.hsCode ? String(data.hsCode) : '');

        // Step 2: Resolve dependent master data
        const divisionId = await tenantMasterData.getOrCreateDivision(data.division as string, brandId);
        const itemSubclassId = await tenantMasterData.getOrCreateItemSubclass(data.subclass as string, itemClassId);
        const subCategoryId = await tenantMasterData.getOrCreateSubCategory(data.subclass as string, categoryId);

        return {
            sku: data.sku ? String(data.sku) : null,
            barCode: data.barCode ? String(data.barCode) : null,
            description: data.description ? String(data.description) : null,
            unitPrice: data.unitPrice ? Number(data.unitPrice) : 0,
            unitCost: data.unitCost ? Number(data.unitCost) : 0, // Map unitCost to unitCost field in DB
            taxRate1: data.taxRate1 ? Number(data.taxRate1) : 0,
            taxRate2: data.taxRate2 ? Number(data.taxRate2) : 0,
            status: data.isActive === false ? 'inactive' : 'active',
            brandId,
            itemClassId,
            itemSubclassId,
            silhouetteId,
            sizeId,
            colorId,
            seasonId,
            genderId,
            categoryId,
            subCategoryId,
            hsCodeId,
            divisionId,
            channelClassId,
            segmentId,
        };
    }
}

