import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { StockUploadCsvParserService, StockUploadParsedRecord } from '../../common/services/stock-upload-csv-parser.service';
import { StockUploadValidatorService } from '../../common/services/stock-upload-validator.service';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { NotificationsService } from '../../notifications/notifications.service';
import * as fs from 'fs';
import * as path from 'path';
import { MovementType } from '@prisma/client';

export interface StockUploadJobData {
    uploadId: string;
    fileBuffer?: Buffer;
    filename: string;
    userId: string;
    tenantId: string;
    tenantDbUrl: string;
    mode: 'validate' | 'import';
    uploadType: 'stock';
}

export interface StockUploadProgress {
    totalRecords: number;
    processedRecords: number;
    successRecords: number;
    failedRecords: number;
    skippedRecords: number;
    errors: Array<{ row: number; reason: string; data: any }>;
}

@Processor('stock-upload')
export class StockUploadProcessor {
    private readonly logger = new Logger(StockUploadProcessor.name);

    constructor(
        private readonly csvParser: StockUploadCsvParserService,
        private readonly validator: StockUploadValidatorService,
        private readonly eventsService: UploadEventsService,
        private readonly notificationsService: NotificationsService,
    ) { }

    @Process()
    async handleUpload(job: Job<any>): Promise<void> {
        let { uploadId, fileBuffer, filename, userId, tenantId, tenantDbUrl, mode } = job.data;
        mode = mode || 'import';

        this.logger.log(`[Job ${job.id}] Stock Upload ${mode.toUpperCase()} started for ${filename} (Upload ID: ${uploadId})`);

        // Reconstruct Buffer if serialised through Redis
        if (fileBuffer && (fileBuffer as any).type === 'Buffer' && Array.isArray((fileBuffer as any).data)) {
            fileBuffer = Buffer.from((fileBuffer as any).data);
        }

        // Recover from disk if missing (import phase)
        if (!fileBuffer) {
            const ext = filename.split('.').pop();
            const filePath = path.join(process.cwd(), 'uploads', 'bulk', 'stock', `stock-upload-${uploadId}.${ext}`);
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
                    message: mode === 'validate' ? 'Starting Stock Upload Validation...' : 'Starting Stock Import...',
                },
            });

            const progress: StockUploadProgress = {
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

            // ─────────────────────────────────────────────────────────
            // IMPORT PHASE
            // ─────────────────────────────────────────────────────────
            if (mode === 'import') {
                this.logger.log(`[Job ${job.id}] Starting Streaming Stock Import for ${uploadId}`);

                const uploadRecord = await prisma.bulkUpload.findUnique({
                    where: { id: uploadId },
                    select: { errors: true, totalRecords: true },
                });

                const allValidationErrors = (Array.isArray(uploadRecord?.errors) ? uploadRecord.errors : []) as any[];
                // Track by row number for skipping invalid rows
                const invalidRows = new Set(allValidationErrors.map((e) => e.row));
                const totalToBeProcessed = (uploadRecord?.totalRecords || 0) - invalidRows.size;

                progress.totalRecords = uploadRecord?.totalRecords || 0;
                progress.failedRecords = invalidRows.size;
                progress.errors = allValidationErrors.map((e) => ({
                    row: e.row,
                    reason: `${e.field}: ${e.reason}`,
                    data: { field: e.field, value: e.value },
                }));

                // Pre-load location code → id map
                // Try Location first (POS outlets), then WarehouseLocation (WMS bins).
                // Location.warehouseId is nullable — for those, derive warehouseId from
                // the WarehouseLocation table which always has one.
                const allLocations = await prisma.location.findMany({
                    select: { id: true, code: true, warehouseId: true },
                });

                // Also load WarehouseLocation bins as a fallback
                const allWarehouseLocations = await (prisma as any).warehouseLocation?.findMany?.({
                    select: { id: true, code: true, warehouseId: true },
                }).catch(() => []) ?? [];

                // Build a unified map: code.toUpperCase() → { id, warehouseId }
                // WarehouseLocation entries go in first (lower priority), then Location
                // entries overwrite so POS outlets take precedence when codes collide.
                const locationByCode = new Map<string, { id: string; code: string; warehouseId: string | null }>();

                for (const wl of allWarehouseLocations) {
                    locationByCode.set(wl.code.toUpperCase(), { id: wl.id, code: wl.code, warehouseId: wl.warehouseId });
                }

                // For Location entries with null warehouseId, try to find a warehouse
                // via the WarehouseLocation join (locations that are POS outlets linked
                // to a warehouse bin area). Fall back to the first warehouse in the DB.
                let fallbackWarehouseId: string | null = null;

                for (const loc of allLocations) {
                    let warehouseId = loc.warehouseId;

                    if (!warehouseId) {
                        // Lazy-load fallback warehouse once
                        if (!fallbackWarehouseId) {
                            const firstWarehouse = await prisma.warehouse.findFirst({
                                where: { isActive: true },
                                select: { id: true },
                                orderBy: { createdAt: 'asc' },
                            });
                            fallbackWarehouseId = firstWarehouse?.id ?? null;
                        }
                        warehouseId = fallbackWarehouseId;
                    }

                    locationByCode.set(loc.code.toUpperCase(), { id: loc.id, code: loc.code, warehouseId });
                }

                const startTime = Date.now();
                let importBatch: StockUploadParsedRecord[] = [];

                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record) => {
                    totalRecordsCount++;
                    if (invalidRows.has(record.row)) return;

                    importBatch.push(record);

                    if (importBatch.length >= 500) {
                        await this.processBatch(importBatch, progress, uploadId, prisma, locationByCode);
                        importBatch = [];

                        await new Promise((resolve) => setImmediate(resolve));

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
                                        message: `Importing Stock: ${progress.processedRecords} @ ${recsPerSec} recs/s (Mem: ${memoryUsageMB}MB)`,
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
                    await this.processBatch(importBatch, progress, uploadId, prisma, locationByCode);
                }

            // ─────────────────────────────────────────────────────────
            // VALIDATE PHASE
            // ─────────────────────────────────────────────────────────
            } else {
                this.eventsService.emit({
                    uploadId,
                    type: 'status',
                    data: { message: 'Streaming stock upload validation scan...' },
                });

                let validationBatch: StockUploadParsedRecord[] = [];
                const allValidationErrors: any[] = [];

                // Pre-load all location codes for existence check during validation
                // Include both Location (POS outlets) and WarehouseLocation (WMS bins)
                const allLocations = await prisma.location.findMany({
                    select: { code: true },
                });
                const allWarehouseLocationsV = await (prisma as any).warehouseLocation?.findMany?.({
                    select: { code: true },
                }).catch(() => []) ?? [];

                const validLocationCodes = new Set([
                    ...allLocations.map((l) => l.code.toUpperCase()),
                    ...allWarehouseLocationsV.map((wl: any) => wl.code.toUpperCase()),
                ]);

                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record) => {
                    totalRecordsCount++;
                    validationBatch.push(record);

                    if (validationBatch.length >= 500) {
                        const batchErrors = this.validator.validateRecords(validationBatch);

                        // Additional: check location codes exist in DB
                        for (const rec of validationBatch) {
                            if (rec.data.locationCode && !validLocationCodes.has(rec.data.locationCode.toUpperCase())) {
                                batchErrors.push({
                                    row: rec.row,
                                    field: 'locationCode',
                                    value: rec.data.locationCode,
                                    reason: `Location code "${rec.data.locationCode}" does not exist in the system.`,
                                });
                            }
                        }

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
                                data: {
                                    progress: 10,
                                    status: 'validating',
                                    message: `Validating Stock: ${totalRecordsCount} records scanned...`,
                                },
                            });
                        }
                    }
                });

                // Final batch
                if (validationBatch.length > 0) {
                    const batchErrors = this.validator.validateRecords(validationBatch);

                    for (const rec of validationBatch) {
                        if (rec.data.locationCode && !validLocationCodes.has(rec.data.locationCode.toUpperCase())) {
                            batchErrors.push({
                                row: rec.row,
                                field: 'locationCode',
                                value: rec.data.locationCode,
                                reason: `Location code "${rec.data.locationCode}" does not exist in the system.`,
                            });
                        }
                    }

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
                        message: `Stock validation complete: ${successRecordsCount} valid, ${allValidationErrors.length} invalid.`,
                        completedAt: new Date(),
                    },
                });

                await this.notificationsService.create({
                    userId,
                    title: 'Stock Upload Validation Completed',
                    message: `Stock bulk validation finished: ${successRecordsCount} valid records, ${allValidationErrors.length} invalid.`,
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

            // ─────────────────────────────────────────────────────────
            // Import complete
            // ─────────────────────────────────────────────────────────
            await prisma.bulkUpload.update({
                where: { id: uploadId },
                data: {
                    status: 'completed',
                    message: `Stock import completed: ${progress.successRecords} ledger entries created.`,
                    completedAt: new Date(),
                },
            });

            await this.notificationsService.create({
                userId,
                title: 'Stock Import Completed',
                message: `Stock bulk import finished: ${progress.successRecords} entries created, ${progress.failedRecords} failed.`,
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
                    title: 'Stock Bulk Job Failed',
                    message: `The Stock ${mode} job failed: ${error.message}`,
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
     * Process a batch of (barcode, locationCode, qty) records.
     *
     * Strategy:
     * 1. Resolve barcode → item.id via item.barCode field
     * 2. Resolve locationCode → location.id + location.warehouseId
     * 3. Create StockLedger entries (OPENING_BALANCE) in bulk
     * 4. Upsert InventoryItem quantities
     */
    private async processBatch(
        batch: StockUploadParsedRecord[],
        progress: StockUploadProgress,
        uploadId: string,
        prisma: PrismaService,
        locationByCode: Map<string, { id: string; code: string; warehouseId: string | null }>,
    ): Promise<void> {
        // Collect unique barcodes for bulk item lookup
        const barCodes = [...new Set(batch.map((r) => r.data.barCode))];

        // Primary lookup: by barCode field
        const itemsByBarCode = await prisma.item.findMany({
            where: { barCode: { in: barCodes } },
            select: { id: true, barCode: true, itemId: true },
        });

        // Secondary lookup: treat the "barcode" value as an itemId (6-digit code)
        // for items that don't have a barCode set but do have a matching itemId.
        const foundBarCodes = new Set(itemsByBarCode.map((i) => i.barCode!));
        const missingBarCodes = barCodes.filter((bc) => !foundBarCodes.has(bc));
        const itemsByItemId = missingBarCodes.length > 0
            ? await prisma.item.findMany({
                where: { itemId: { in: missingBarCodes } },
                select: { id: true, barCode: true, itemId: true },
            })
            : [];

        // Build unified map: barCode/itemId value → item.id
        const itemByBarCode = new Map<string, string>();
        for (const item of itemsByBarCode) {
            if (item.barCode) itemByBarCode.set(item.barCode, item.id);
        }
        for (const item of itemsByItemId) {
            // Key by the value that was in the sheet (the missing barcode = itemId)
            itemByBarCode.set(item.itemId, item.id);
        }

        const ledgerEntries: any[] = [];
        const inventoryUpserts: Array<{
            itemId: string;
            warehouseId: string;
            locationId: string;
            qty: number;
        }> = [];

        for (const record of batch) {
            const { barCode, locationCode, qty } = record.data;

            const itemId = itemByBarCode.get(barCode);
            if (!itemId) {
                this.logger.warn(`BarCode "${barCode}" not found in items at row ${record.row}. Skipping.`);
                progress.failedRecords++;
                progress.errors.push({
                    row: record.row,
                    reason: `BarCode "${barCode}" not found in the item master.`,
                    data: record.data,
                });
                progress.processedRecords++;
                continue;
            }

            const location = locationByCode.get(locationCode.toUpperCase());
            if (!location || !location.warehouseId) {
                this.logger.warn(`Location code "${locationCode}" not found or has no warehouse at row ${record.row}. Skipping.`);
                progress.failedRecords++;
                progress.errors.push({
                    row: record.row,
                    reason: `Location code "${locationCode}" not found or has no associated warehouse.`,
                    data: record.data,
                });
                progress.processedRecords++;
                continue;
            }

            // Determine movement type based on qty sign
            const movementType: MovementType = qty >= 0 ? MovementType.OPENING_BALANCE : MovementType.OUTBOUND;

            ledgerEntries.push({
                itemId,
                warehouseId: location.warehouseId,
                locationId: location.id,
                qty,
                movementType,
                referenceType: 'BULK_STOCK_UPLOAD',
                referenceId: uploadId,
                rate: null,
                unitCost: null,
            });

            inventoryUpserts.push({
                itemId,
                warehouseId: location.warehouseId,
                locationId: location.id,
                qty,
            });

            progress.processedRecords++;
        }

        // Bulk create ledger entries
        if (ledgerEntries.length > 0) {
            try {
                await prisma.stockLedger.createMany({
                    data: ledgerEntries,
                    skipDuplicates: false, // ledger is append-only, no duplicates concept
                });
                progress.successRecords += ledgerEntries.length;
            } catch (error) {
                this.logger.error(`Bulk ledger create failed: ${error.message}`);
                // Fallback to individual creates
                for (const entry of ledgerEntries) {
                    try {
                        await prisma.stockLedger.create({ data: entry });
                        progress.successRecords++;
                    } catch (e) {
                        progress.failedRecords++;
                        this.logger.error(`Individual ledger create failed: ${e.message}`);
                    }
                }
            }
        }

        // Upsert InventoryItem quantities
        // NOTE: prisma.inventoryItem.upsert() cannot be used here because the compound
        // unique key includes nullable fields (batchNumber, serialNumber) and Prisma's
        // runtime rejects null in compound unique where clauses. Use findFirst + update/create.
        for (const inv of inventoryUpserts) {
            try {
                const existing = await prisma.inventoryItem.findFirst({
                    where: {
                        itemId: inv.itemId,
                        locationId: inv.locationId,
                        batchNumber: null,
                        serialNumber: null,
                        status: 'AVAILABLE',
                    },
                    select: { id: true },
                });

                if (existing) {
                    await prisma.inventoryItem.update({
                        where: { id: existing.id },
                        data: { quantity: { increment: inv.qty } },
                    });
                } else {
                    await prisma.inventoryItem.create({
                        data: {
                            itemId: inv.itemId,
                            warehouseId: inv.warehouseId,
                            locationId: inv.locationId,
                            quantity: inv.qty,
                            status: 'AVAILABLE',
                        },
                    });
                }
            } catch (e) {
                this.logger.error(`InventoryItem update failed for item ${inv.itemId} at location ${inv.locationId}: ${e.message}`);
            }
        }
    }
}
