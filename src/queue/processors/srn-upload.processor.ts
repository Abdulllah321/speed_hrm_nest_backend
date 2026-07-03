import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { SrnCsvParserService, SrnParsedRecord } from '../../common/services/srn-csv-parser.service';
import { SrnValidatorService } from '../../common/services/srn-validator.service';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { Decimal } from '@prisma/client/runtime/client';
import * as fs from 'fs';
import * as path from 'path';

interface SrnUploadProgress {
    totalRecords: number;
    processedRecords: number;
    successRecords: number;
    failedRecords: number;
    skippedRecords: number;
    errors: Array<{ row: number; reason: string; data: any }>;
}

@Processor('srn-upload')
export class SrnUploadProcessor {
    private readonly logger = new Logger(SrnUploadProcessor.name);

    constructor(
        private readonly csvParser: SrnCsvParserService,
        private readonly validator: SrnValidatorService,
        private readonly eventsService: UploadEventsService,
        private readonly notificationsService: NotificationsService,
    ) { }

    @Process()
    async handleUpload(job: Job<any>): Promise<void> {
        let { uploadId, fileBuffer, filename, userId, tenantId, tenantDbUrl, mode, metadata } = job.data;
        mode = mode || 'import';

        if (fileBuffer && (fileBuffer as any).type === 'Buffer' && Array.isArray((fileBuffer as any).data)) {
            fileBuffer = Buffer.from((fileBuffer as any).data);
        }

        if (!fileBuffer) {
            const ext = filename.split('.').pop();
            const filePath = path.join(process.cwd(), 'uploads', 'bulk', 'srn', `srn-upload-${uploadId}.${ext}`);
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
                data: {
                    status: mode === 'validate' ? 'validating' : 'processing',
                    message: mode === 'validate' ? 'Starting SRN Validation...' : 'Starting SRN Import...',
                },
            });

            const progress: SrnUploadProgress = {
                totalRecords: 0, processedRecords: 0,
                successRecords: 0, failedRecords: 0, skippedRecords: 0, errors: [],
            };

            let totalRecordsCount = 0;
            let successRecordsCount = 0;
            let lastEmitTime = Date.now();

            if (mode === 'import') {
                // ── IMPORT MODE ──────────────────────────────────────────────
                const uploadRecord = await prisma.bulkUpload.findUnique({
                    where: { id: uploadId },
                    select: { errors: true, totalRecords: true },
                });

                const allValidationErrors = (Array.isArray(uploadRecord?.errors) ? uploadRecord.errors : []) as any[];
                const invalidRows = new Set(allValidationErrors.map((e: any) => e.row));

                progress.totalRecords = uploadRecord?.totalRecords || 0;
                progress.failedRecords = invalidRows.size;

                const validRecords: SrnParsedRecord[] = [];

                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record) => {
                    totalRecordsCount++;
                    if (!invalidRows.has(record.row)) validRecords.push(record);
                });

                if (validRecords.length === 0) {
                    throw new Error('No valid records to import');
                }

                try {
                    await this.createSrnWithMetadata(metadata, validRecords, progress, prisma, userId);
                } catch (err: any) {
                    this.logger.error(`Failed to create SRN: ${err.message}`);
                    progress.failedRecords += validRecords.length;
                    progress.errors.push({ row: validRecords[0].row, reason: err.message, data: {} });
                }

                progress.processedRecords = validRecords.length;
                await job.progress(100);
                this.eventsService.emit({
                    uploadId, type: 'progress',
                    data: {
                        progress: 100,
                        processedRecords: progress.processedRecords,
                        successRecords: progress.successRecords,
                        failedRecords: progress.failedRecords,
                        status: 'processing',
                    },
                });

            } else {
                // ── VALIDATE MODE ────────────────────────────────────────────
                this.eventsService.emit({ uploadId, type: 'status', data: { message: 'Streaming SRN validation...' } });

                const allParsedRecords: SrnParsedRecord[] = [];
                const allValidationErrors: any[] = [];

                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record) => {
                    totalRecordsCount++;
                    allParsedRecords.push(record);

                    const now = Date.now();
                    if (now - lastEmitTime > 2000) {
                        lastEmitTime = now;
                        await job.progress(10);
                        this.eventsService.emit({
                            uploadId, type: 'progress',
                            data: { progress: 10, status: 'validating', message: `Scanning SRN records: ${totalRecordsCount} rows...` },
                        });
                    }
                });

                // 1. Basic field-level validations
                const basicErrors = allParsedRecords.flatMap(r => this.validator.validateRecord(r));
                allValidationErrors.push(...basicErrors);

                // 2. BarCode / SKU existence check against DB
                const barcodes = [...new Set(allParsedRecords.map(r => r.data.barCode?.trim()).filter(Boolean) as string[])];
                const skus     = [...new Set(allParsedRecords.map(r => r.data.sku?.trim()).filter(Boolean) as string[])];

                const items = await (prisma as any).item.findMany({
                    where: {
                        OR: [
                            ...(barcodes.length > 0 ? [{ barCode: { in: barcodes } }] : []),
                            ...(skus.length > 0 ? [{ sku: { in: skus } }] : []),
                        ],
                    },
                    select: { id: true, barCode: true, sku: true },
                });
                const foundBarcodes = new Set(items.map((i: any) => i.barCode?.trim()).filter(Boolean));
                const foundSkus     = new Set(items.map((i: any) => i.sku?.trim()).filter(Boolean));

                for (const record of allParsedRecords) {
                    const barCode = record.data.barCode?.trim();
                    const sku     = record.data.sku?.trim();
                    // If a row provides a barCode, it must exist; same for SKU
                    if (barCode && !foundBarcodes.has(barCode)) {
                        allValidationErrors.push({ row: record.row, field: 'barCode', value: barCode, reason: `BarCode "${barCode}" not found in item master.` });
                    } else if (!barCode && sku && !foundSkus.has(sku)) {
                        allValidationErrors.push({ row: record.row, field: 'SKU', value: sku, reason: `SKU "${sku}" not found in item master.` });
                    }
                }

                const uniqueFailedRows = new Set(allValidationErrors.map(e => e.row)).size;
                successRecordsCount = totalRecordsCount - uniqueFailedRows;

                await prisma.bulkUpload.update({
                    where: { id: uploadId },
                    data: {
                        status: 'validated',
                        totalRecords: totalRecordsCount,
                        failedRecords: allValidationErrors.length,
                        successRecords: successRecordsCount,
                        errors: allValidationErrors as any,
                        message: `Validation complete: ${successRecordsCount} valid rows, ${allValidationErrors.length} invalid.`,
                        completedAt: new Date(),
                    },
                });

                await this.notificationsService.create({
                    userId, title: 'SRN Validation Completed',
                    message: `SRN bulk validation finished: ${successRecordsCount} valid rows, ${allValidationErrors.length} invalid.`,
                    category: 'system', priority: 'normal', channels: ['inApp'],
                });

                await job.progress(100);
                this.eventsService.emit({
                    uploadId, type: 'completed',
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

            await prisma.bulkUpload.update({
                where: { id: uploadId },
                data: {
                    status: 'completed',
                    processedRecords: progress.processedRecords,
                    successRecords: progress.successRecords,
                    failedRecords: progress.failedRecords,
                    errors: progress.errors as any,
                    message: `Import completed: ${progress.successRecords} SRNs created.`,
                    completedAt: new Date(),
                },
            });

            await this.notificationsService.create({
                userId, title: 'SRN Import Completed',
                message: `SRN bulk import finished: ${progress.successRecords} SRNs created, ${progress.failedRecords} rows failed.`,
                category: 'system', priority: 'high', channels: ['inApp'],
            });

            this.eventsService.emit({
                uploadId, type: 'completed',
                data: { status: 'completed', successRecords: progress.successRecords, failedRecords: progress.failedRecords, progress: 100 },
            });

        } catch (error: any) {
            this.logger.error(`[Job ${job.id}] FAILED: ${error.message}`, error.stack);
            try {
                await prisma.bulkUpload.update({
                    where: { id: uploadId },
                    data: { status: 'failed', completedAt: new Date(), message: `Error: ${error.message}` },
                });
                await this.notificationsService.create({
                    userId, title: 'SRN Bulk Job Failed',
                    message: `SRN ${mode} job failed: ${error.message}`,
                    category: 'system', priority: 'urgent', channels: ['inApp'],
                });
                this.eventsService.emit({ uploadId, type: 'failed', data: { message: error.message } });
            } catch (e: any) {
                this.logger.error(`Failed to update failure status: ${e.message}`);
            }
        } finally {
            await prisma.$disconnect();
        }
    }

    private async createSrnWithMetadata(
        metadata: any,
        records: SrnParsedRecord[],
        progress: SrnUploadProgress,
        prisma: PrismaService,
        userId: string,
    ): Promise<void> {
        const fromWarehouseId = metadata?.fromWarehouseId;
        const toLocationId = metadata?.toLocationId;
        if (!fromWarehouseId) throw new Error('Source warehouse is required for SRN import but none was provided.');
        if (!toLocationId) throw new Error('Destination location is required for SRN import but none was provided.');

        const documentType = metadata?.documentType || 'New Arrival';
        const financialYear = metadata?.financialYear || '25-26';
        const remarks = metadata?.remarks || null;
        const notes = metadata?.notes || null;
        const brandId = metadata?.brandId && metadata.brandId !== 'none' ? metadata.brandId : null;

        // Resolve all items by barCode OR SKU in one batch query
        const barcodes = [...new Set(records.map(r => r.data.barCode?.trim()).filter(Boolean) as string[])];
        const skus     = [...new Set(records.map(r => r.data.sku?.trim()).filter(Boolean) as string[])];

        const items = await (prisma as any).item.findMany({
            where: {
                OR: [
                    ...(barcodes.length > 0 ? [{ barCode: { in: barcodes } }] : []),
                    ...(skus.length > 0 ? [{ sku: { in: skus } }] : []),
                ],
            },
            select: { id: true, barCode: true, sku: true, description: true },
        });

        // Build lookup maps for both identifiers
        const barCodeMap = new Map<string, any>(items.filter((i: any) => i.barCode).map((i: any) => [i.barCode.trim(), i]));
        const skuMap     = new Map<string, any>(items.filter((i: any) => i.sku).map((i: any) => [i.sku.trim(), i]));

        const itemsData: { itemId: string; quantity: Decimal }[] = [];

        for (const record of records) {
            const barCode = record.data.barCode?.trim();
            const sku     = record.data.sku?.trim();

            // barCode takes priority; fall back to SKU
            const item = (barCode ? barCodeMap.get(barCode) : undefined) ?? (sku ? skuMap.get(sku) : undefined);
            const identifier = barCode || sku || 'unknown';

            if (!item) {
                progress.failedRecords++;
                progress.errors.push({ row: record.row, reason: `"${identifier}" not found in item master`, data: { field: barCode ? 'barCode' : 'SKU', value: identifier } });
                continue;
            }

            const qty = new Decimal(record.data.quantity!);
            itemsData.push({ itemId: item.id, quantity: qty });
        }

        if (itemsData.length === 0) return;

        const requisitionNo = `SRN-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

        // Create SRN (status: PENDING, will also create stock reserves)
        await (prisma as any).$transaction(async (tx: any) => {
            // 1. Validate stock availability
            for (const reqItem of itemsData) {
                const stockItem = await tx.inventoryItem.findFirst({
                    where: { warehouseId: fromWarehouseId, locationId: null, itemId: reqItem.itemId, status: 'AVAILABLE' },
                });
                const physicalQty = stockItem ? Number(stockItem.quantity) : 0;

                const reservations = await tx.stockReserve.aggregate({
                    where: {
                        itemId: reqItem.itemId,
                        warehouseId: fromWarehouseId,
                        OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
                    },
                    _sum: { quantity: true },
                });
                const reservedQty = reservations._sum.quantity ? Number(reservations._sum.quantity) : 0;
                const netAvailable = Math.max(0, physicalQty - reservedQty);
                const requestedQty = Number(reqItem.quantity);

                if (netAvailable < requestedQty) {
                    const itemDetail = await tx.item.findUnique({ where: { id: reqItem.itemId }, select: { sku: true } });
                    throw new Error(
                        `Insufficient stock for ${itemDetail?.sku || reqItem.itemId}. Available (unreserved): ${netAvailable}, Requested: ${requestedQty}`,
                    );
                }
            }

            // 2. Create StockRequisition
            const requisition = await tx.stockRequisition.create({
                data: {
                    requisitionNo,
                    fromWarehouseId,
                    toLocationId,
                    brandId,
                    documentType,
                    remarks,
                    notes,
                    financialYear,
                    status: 'PENDING',
                    createdById: userId,
                    items: { create: itemsData },
                },
            });

            // 3. Create StockReserve records
            for (const reqItem of itemsData) {
                await tx.stockReserve.create({
                    data: {
                        itemId: reqItem.itemId,
                        warehouseId: fromWarehouseId,
                        quantity: reqItem.quantity,
                        referenceType: 'STOCK_REQUISITION',
                        referenceId: requisition.id,
                        notes: `Reserved for SRN ${requisitionNo} (bulk import)`,
                        createdById: userId,
                    },
                });
            }

            return requisition;
        });

        progress.successRecords++;
    }
}
