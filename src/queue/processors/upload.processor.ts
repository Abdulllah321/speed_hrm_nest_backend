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

        // Recover from disk if missing (import phase)
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
        this.logger.log(`[Job ${job.id}] Connected to tenant DB: ${tenantId}`);

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

            // Parsing
            this.eventsService.emit({ uploadId, type: 'status', data: { message: 'Parsing records...' } });
            await job.progress(5);
            const records = await this.csvParser.parseFile(fileBuffer, filename);
            await job.progress(15);

            if (records.length === 0) {
                throw new Error('No valid records found in file');
            }

            this.logger.log(`[Job ${job.id}] Parsed ${records.length} records`);

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
                this.eventsService.emit({ uploadId, type: 'status', data: { message: `Scanning ${records.length} records...` } });
                await job.progress(20);

                const validationErrors = await this.validator.validateRecords(records);
                await job.progress(40);

                const duplicateItemIDErrors = this.validator.checkDuplicateItemIDs(records);
                await job.progress(50);

                allValidationErrors = [
                    ...validationErrors,
                    ...duplicateItemIDErrors,
                ];
            }

            const invalidRows = new Set(allValidationErrors.map(e => e.row));
            const validRecords = records.filter(r => !invalidRows.has(r.row));

            this.logger.log(`[Job ${job.id}] Validation result: ${validRecords.length} valid, ${allValidationErrors.length} invalid`);

            const progress: UploadProgress = {
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
                        message: `Validation complete: ${validRecords.length} valid, ${allValidationErrors.length} invalid.`,
                        completedAt: new Date(),
                    },
                });

                await this.notificationsService.create({
                    userId,
                    title: 'Validation Completed',
                    message: `Bulk validation finished: ${validRecords.length} valid rows, ${allValidationErrors.length} invalid.`,
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
            this.logger.log(`[Job ${job.id}] Importing ${validRecords.length} items`);
            const batchSize = 100; // Smaller batches for better SSE granularity

            for (let i = 0; i < validRecords.length; i += batchSize) {
                const batch = validRecords.slice(i, i + batchSize);
                await this.processBatch(batch, progress, uploadId, prisma, tenantMasterData);

                await prisma.bulkUpload.update({
                    where: { id: uploadId },
                    data: {
                        processedRecords: progress.processedRecords,
                        successRecords: progress.successRecords,
                        failedRecords: progress.failedRecords,
                        message: `Importing: ${progress.processedRecords} of ${validRecords.length} items...`,
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
        } finally {
            if (prisma) await prisma.$disconnect();
        }
    }

    /**
     * Process a batch of records with individual error isolation
     */
    private async processBatch(batch: ParsedRecord[], progress: UploadProgress, uploadId: string, prisma: PrismaService, tenantMasterData: MasterDataService): Promise<void> {
        for (const record of batch) {
            try {
                // Individual record processing wrapped in try-catch
                await this.processRecord(record, prisma, tenantMasterData);
                progress.successRecords++;
            } catch (error) {
                // Log error but continue processing
                this.logger.warn(`Failed to process row ${record.row}: ${error.message}`);
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

    private async processRecord(record: ParsedRecord, prisma: PrismaService, tenantMasterData: MasterDataService): Promise<void> {
        const { data } = record;

        // Check if item already exists (by ItemID)
        const existing = await prisma.item.findFirst({
            where: {
                itemId: String(data.itemId),
            },
        });

        if (existing) {
            throw new Error(`Item with ItemID "${data.itemId}" already exists`);
        }

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

        // Step 2: Resolve dependent master data
        const divisionId = await tenantMasterData.getOrCreateDivision(data.division as string, brandId);
        const itemSubclassId = await tenantMasterData.getOrCreateItemSubclass(data.subclass as string, itemClassId);
        const subCategoryId = await tenantMasterData.getOrCreateSubCategory(data.subclass as string, categoryId);

        // Create item
        await prisma.item.create({
            data: {
                itemId: String(data.itemId),
                sku: String(data.sku),
                barCode: data.barCode ? String(data.barCode) : null,
                hsCode: data.hsCode ? String(data.hsCode) : null,
                description: data.description ? String(data.description) : null,
                status: data.isActive === false ? 'inactive' : 'active',
                isActive: data.isActive !== false,
                unitPrice: Number(data.unitPrice) || 0,
                taxRate1: Number(data.taxRate1) || 0,
                taxRate2: Number(data.taxRate2) || 0,
                discountRate: Number(data.discountRate) || 0,
                discountAmount: Number(data.discountAmount) || 0,
                discountStartDate: data.discountStartDate || null,
                discountEndDate: data.discountEndDate || null,
                case: data.case ? String(data.case) : null,
                band: data.band ? String(data.band) : null,
                movementType: data.movementType ? String(data.movementType) : null,
                heelHeight: data.heelHeight ? String(data.heelHeight) : null,
                width: data.width ? String(data.width) : null,
                brandId,
                sizeId,
                colorId,
                divisionId,
                genderId,
                categoryId,
                subCategoryId,
                itemClassId,
                itemSubclassId,
                silhouetteId,
                channelClassId,
                seasonId,
                segmentId,
            },
        });
    }
}

