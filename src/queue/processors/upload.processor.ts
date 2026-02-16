import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { CsvParserService, ParsedRecord } from '../../common/services/csv-parser.service';
import { MasterDataService } from '../../common/services/master-data.service';
import { ItemValidatorService, ValidationError } from '../../common/services/item-validator.service';

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
    private prisma: PrismaService;

    constructor(
        private readonly csvParser: CsvParserService,
        private readonly masterData: MasterDataService,
        private readonly validator: ItemValidatorService,
    ) { }

    @Process()
    async handleUpload(job: Job<UploadJobData>): Promise<void> {
        let { uploadId, fileBuffer, filename, userId, tenantId, tenantDbUrl } = job.data;

        // Reconstruct Buffer if it was serialized as a plain object by Bull/Redis
        if (fileBuffer && (fileBuffer as any).type === 'Buffer' && Array.isArray((fileBuffer as any).data)) {
            this.logger.debug(`Reconstructing Buffer from serialized data (${(fileBuffer as any).data.length} bytes)`);
            fileBuffer = Buffer.from((fileBuffer as any).data);
        }

        // Initialize Prisma for this job's tenant
        this.prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

        this.logger.log(`Starting upload job for ${filename} (Upload ID: ${uploadId}) on tenant: ${tenantId}`);

        try {
            // Update status to processing
            await this.prisma.bulkUpload.update({
                where: { id: uploadId },
                data: { status: 'processing' },
            });

            // Step 1: Parse file
            this.logger.log(`Parsing file: ${filename}`);
            await this.prisma.bulkUpload.update({
                where: { id: uploadId },
                data: { message: 'Parsing the file and identifying rows...' },
            });
            const records = await this.csvParser.parseFile(fileBuffer, filename);

            if (records.length === 0) {
                throw new Error('No valid records found in file');
            }

            // Update total records count
            await this.prisma.bulkUpload.update({
                where: { id: uploadId },
                data: { totalRecords: records.length },
            });

            // Step 2: Validate all records
            this.logger.log(`Validating ${records.length} records`);
            await this.prisma.bulkUpload.update({
                where: { id: uploadId },
                data: {
                    totalRecords: records.length,
                    message: `Validating ${records.length} records...`,
                },
            });
            const validationErrors = await this.validator.validateRecords(records);
            const duplicateSKUErrors = this.validator.checkDuplicateSKUs(records);
            const duplicateItemIDErrors = this.validator.checkDuplicateItemIDs(records);

            const allValidationErrors = [
                ...validationErrors,
                ...duplicateSKUErrors,
                ...duplicateItemIDErrors,
            ];

            // Create a set of invalid row numbers
            const invalidRows = new Set(allValidationErrors.map(e => e.row));

            // Filter out invalid records
            const validRecords = records.filter(r => !invalidRows.has(r.row));

            this.logger.log(`${validRecords.length} valid records, ${invalidRows.size} invalid records`);

            // Step 3: Process records in batches
            const batchSize = 1000;
            const progress: UploadProgress = {
                totalRecords: records.length,
                processedRecords: 0,
                successRecords: 0,
                failedRecords: invalidRows.size,
                skippedRecords: 0,
                errors: allValidationErrors.map(e => ({
                    row: e.row,
                    reason: `${e.field}: ${e.reason}`,
                    data: { field: e.field, value: e.value },
                })),
            };

            // Process in batches
            for (let i = 0; i < validRecords.length; i += batchSize) {
                const batch = validRecords.slice(i, i + batchSize);

                this.logger.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(validRecords.length / batchSize)}`);

                // Update progress in database
                await this.prisma.bulkUpload.update({
                    where: { id: uploadId },
                    data: {
                        processedRecords: progress.processedRecords,
                        successRecords: progress.successRecords,
                        failedRecords: progress.failedRecords,
                        skippedRecords: progress.skippedRecords,
                        errors: progress.errors as any,
                        message: `Processing records: ${progress.processedRecords} of ${progress.totalRecords} (${progress.successRecords} success, ${progress.failedRecords} failed)`,
                    },
                });

                await this.processBatch(batch, progress);

                // Update job progress
                await job.progress(Math.round((progress.processedRecords / progress.totalRecords) * 100));
            }

            // Mark as completed
            await this.prisma.bulkUpload.update({
                where: { id: uploadId },
                data: {
                    status: 'completed',
                    message: `Upload completed successfully: ${progress.successRecords} records added.`,
                    completedAt: new Date(),
                },
            });

            this.logger.log(`Upload completed: ${progress.successRecords} success, ${progress.failedRecords} failed, ${progress.skippedRecords} skipped`);

        } catch (error) {
            this.logger.error(`Upload job failed: ${error.message}`, error.stack);

            // Mark as failed
            await this.prisma.bulkUpload.update({
                where: { id: uploadId },
                data: {
                    status: 'failed',
                    completedAt: new Date(),
                    errors: [{
                        row: 0,
                        reason: `Fatal error: ${error.message}`,
                        data: {},
                    }],
                },
            });

        } finally {
            if (this.prisma) {
                await this.prisma.$disconnect();
            }
        }
    }

    /**
     * Process a batch of records with individual error isolation
     */
    private async processBatch(batch: ParsedRecord[], progress: UploadProgress): Promise<void> {
        for (const record of batch) {
            try {
                // Individual record processing wrapped in try-catch
                await this.processRecord(record);
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

    /**
     * Process a single record
     */
    private async processRecord(record: ParsedRecord): Promise<void> {
        const { data } = record;

        // Check if item already exists (by SKU or ItemID)
        const existing = await this.prisma.item.findFirst({
            where: {
                OR: [
                    { sku: data.sku },
                    { itemId: data.itemId },
                ],
            },
        });

        if (existing) {
            throw new Error(`Item with SKU "${data.sku}" or ItemID "${data.itemId}" already exists`);
        }

        // Step 1: Resolve high-level master data
        const [
            brandId,
            itemClassId,
            categoryId,
            sizeId,
            colorId,
            genderId,
            silhouetteId,
            channelClassId,
            seasonId,
            uomId,
            segmentId,
        ] = await Promise.all([
            this.masterData.getOrCreateBrand(data.concept as string),
            this.masterData.getOrCreateItemClass(data.class as string),
            this.masterData.getOrCreateCategory(data.productCategory as string),
            this.masterData.getOrCreateSize(data.size as string),
            this.masterData.getOrCreateColor(data.color as string),
            this.masterData.getOrCreateGender(data.gender as string),
            this.masterData.getOrCreateSilhouette(data.silhouette as string),
            this.masterData.getOrCreateChannelClass(data.channelClass as string),
            this.masterData.getOrCreateSeason(data.season as string),
            this.masterData.getOrCreateUom(data.uom as string),
            this.masterData.getOrCreateSegment(data.segment as string),
        ]);

        // Step 2: Resolve dependent master data
        const [
            divisionId,
            itemSubclassId,
            subCategoryId,
        ] = await Promise.all([
            this.masterData.getOrCreateDivision(data.division as string, brandId),
            this.masterData.getOrCreateItemSubclass(data.subclass as string, itemClassId),
            this.masterData.getOrCreateSubCategory(data.subclass as string, categoryId),
        ]);

        // Create item
        await this.prisma.item.create({
            data: {
                itemId: data.itemId as string,
                sku: data.sku as string,
                barCode: data.barCode || null,
                hsCode: data.hsCode || null,
                description: data.description || null,
                status: data.isActive === false ? 'inactive' : 'active',
                isActive: data.isActive !== false,
                unitPrice: data.unitPrice || 0,
                taxRate1: data.taxRate1 || 0,
                taxRate2: data.taxRate2 || 0,
                discountRate: data.discountRate || 0,
                discountAmount: data.discountAmount || 0,
                discountStartDate: data.discountStartDate || null,
                discountEndDate: data.discountEndDate || null,
                case: data.case || null,
                band: data.band || null,
                movementType: data.movementType || null,
                heelHeight: data.heelHeight || null,
                width: data.width || null,
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
                uomId,
                segmentId,
            },
        });
    }
}

