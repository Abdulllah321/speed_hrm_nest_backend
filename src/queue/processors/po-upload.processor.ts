import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { PoCsvParserService, PoParsedRecord } from '../../common/services/po-csv-parser.service';
import { PoValidatorService } from '../../common/services/po-validator.service';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { Decimal } from '@prisma/client/runtime/client';
import * as fs from 'fs';
import * as path from 'path';

interface PoUploadProgress {
    totalRecords: number;
    processedRecords: number;
    successRecords: number;  // POs created
    failedRecords: number;
    skippedRecords: number;
    errors: Array<{ row: number; reason: string; data: any }>;
}

@Processor('po-upload')
export class PoUploadProcessor {
    private readonly logger = new Logger(PoUploadProcessor.name);

    constructor(
        private readonly csvParser: PoCsvParserService,
        private readonly validator: PoValidatorService,
        private readonly eventsService: UploadEventsService,
        private readonly notificationsService: NotificationsService,
    ) { }

    @Process()
    async handleUpload(job: Job<any>): Promise<void> {
        let { uploadId, fileBuffer, filename, userId, tenantId, tenantDbUrl, mode } = job.data;
        mode = mode || 'import';

        if (fileBuffer && (fileBuffer as any).type === 'Buffer' && Array.isArray((fileBuffer as any).data)) {
            fileBuffer = Buffer.from((fileBuffer as any).data);
        }

        if (!fileBuffer) {
            const ext = filename.split('.').pop();
            const filePath = path.join(process.cwd(), 'uploads', 'bulk', 'po', `po-upload-${uploadId}.${ext}`);
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
                data: { status: mode === 'validate' ? 'validating' : 'processing', message: mode === 'validate' ? 'Starting PO Validation...' : 'Starting PO Import...' }
            });

            const progress: PoUploadProgress = {
                totalRecords: 0, processedRecords: 0,
                successRecords: 0, failedRecords: 0, skippedRecords: 0, errors: [],
            };

            let totalRecordsCount = 0;
            let successRecordsCount = 0;
            let lastEmitTime = Date.now();

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

                // Collect all valid records — single vendor per file
                const validRecords: PoParsedRecord[] = [];

                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record) => {
                    totalRecordsCount++;
                    if (!invalidRows.has(record.row)) validRecords.push(record);
                });

                if (validRecords.length === 0) {
                    throw new Error('No valid records to import');
                }

                // Single vendor — use the vendor code from the first valid record
                const vendorCode = validRecords[0].data.vendorCode!.trim().toUpperCase();
                const startTime = Date.now();

                try {
                    await this.createPoForVendor(vendorCode, validRecords, progress, prisma);
                } catch (err: any) {
                    this.logger.error(`Failed to create PO for vendor ${vendorCode}: ${err.message}`);
                    progress.failedRecords += validRecords.length;
                    progress.errors.push({ row: validRecords[0].row, reason: err.message, data: {} });
                }

                progress.processedRecords = validRecords.length;
                await job.progress(100);
                this.eventsService.emit({
                    uploadId, type: 'progress',
                    data: { progress: 100, processedRecords: progress.processedRecords, successRecords: progress.successRecords, failedRecords: progress.failedRecords, status: 'processing' }
                });

            } else {
                // Validation mode
                this.eventsService.emit({ uploadId, type: 'status', data: { message: 'Streaming PO validation...' } });

                let validationBatch: PoParsedRecord[] = [];
                const allValidationErrors: any[] = [];

                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record) => {
                    totalRecordsCount++;
                    validationBatch.push(record);

                    if (validationBatch.length >= 500) {
                        // Per-row validation only in batches
                        const batchErrors = validationBatch.flatMap(r => this.validator.validateRecord(r));
                        allValidationErrors.push(...batchErrors);
                        successRecordsCount += validationBatch.length - new Set(batchErrors.map(e => e.row)).size;
                        validationBatch = [];

                        const now = Date.now();
                        if (now - lastEmitTime > 2000) {
                            lastEmitTime = now;
                            await job.progress(10);
                            this.eventsService.emit({ uploadId, type: 'progress', data: { progress: 10, status: 'validating', message: `Validating: ${totalRecordsCount} rows scanned...` } });
                        }
                    }
                });

                // Final batch + cross-row validation on all records
                const allRecords = validationBatch; // remaining
                if (allRecords.length > 0) {
                    const batchErrors = allRecords.flatMap(r => this.validator.validateRecord(r));
                    allValidationErrors.push(...batchErrors);
                    successRecordsCount += allRecords.length - new Set(batchErrors.map(e => e.row)).size;
                }

                // Cross-row rules (single vendor, consistent orderType/goodsType)
                // Re-parse all records for cross-row check (they're already in memory via validationBatch accumulation)
                // We need all records — re-collect from the full parse above
                // Since we cleared batches, we need to re-parse for cross-row. Use a lightweight second pass.
                const allParsedRecords: PoParsedRecord[] = [];
                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record) => {
                    allParsedRecords.push(record);
                });
                const crossErrors = this.validator.validateRecords(allParsedRecords).filter(
                    e => !allValidationErrors.some(ex => ex.row === e.row && ex.field === e.field)
                );
                allValidationErrors.push(...crossErrors);

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
                    userId, title: 'PO Validation Completed',
                    message: `PO bulk validation finished: ${successRecordsCount} valid rows, ${allValidationErrors.length} invalid.`,
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
                data: { status: 'completed', message: `Import completed: ${progress.successRecords} POs created.`, completedAt: new Date() },
            });

            await this.notificationsService.create({
                userId, title: 'PO Import Completed',
                message: `PO bulk import finished: ${progress.successRecords} POs created, ${progress.failedRecords} rows failed.`,
                category: 'system', priority: 'high', channels: ['inApp'],
            });

            this.eventsService.emit({
                uploadId, type: 'completed',
                data: { status: 'completed', successRecords: progress.successRecords, failedRecords: progress.failedRecords, progress: 100 }
            });

        } catch (error: any) {
            this.logger.error(`[Job ${job.id}] FAILED: ${error.message}`, error.stack);
            try {
                await prisma.bulkUpload.update({
                    where: { id: uploadId },
                    data: { status: 'failed', completedAt: new Date(), message: `Error: ${error.message}` },
                });
                await this.notificationsService.create({
                    userId, title: 'PO Bulk Job Failed',
                    message: `PO ${mode} job failed: ${error.message}`,
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

    private async createPoForVendor(vendorCode: string, records: PoParsedRecord[], progress: PoUploadProgress, prisma: PrismaService): Promise<void> {
        // Resolve vendor by code
        const vendor = await (prisma as any).supplier.findFirst({ where: { code: vendorCode } });
        if (!vendor) throw new Error(`Vendor with code "${vendorCode}" not found`);

        const orderType = records[0].data.orderType!.toUpperCase();
        const goodsType = records[0].data.goodsType!.toUpperCase();

        // Enforce vendor type matches order type
        const mismatch = this.validator.validateVendorOrderTypeMatch(vendor.type || 'LOCAL', orderType);
        if (mismatch) throw new Error(mismatch);

        // Resolve all items by unique itemId in one query
        const itemIds = [...new Set(records.map(r => r.data.itemId!.trim()))];
        const items = await (prisma as any).item.findMany({
            where: { itemId: { in: itemIds } },
            select: { id: true, itemId: true },
        });
        const itemMap = new Map(items.map((i: any) => [i.itemId.trim(), i.id]));

        const expectedDeliveryDate = records[0].data.expectedDeliveryDate ? new Date(records[0].data.expectedDeliveryDate) : null;
        const notes = records[0].data.notes || null;

        let subtotal = new Decimal(0);
        const itemsData: any[] = [];

        for (const record of records) {
            const itemId = record.data.itemId!.trim();
            const dbItemId = itemMap.get(itemId);
            if (!dbItemId) {
                progress.failedRecords++;
                progress.errors.push({ row: record.row, reason: `Item ID "${itemId}" not found in item master`, data: { field: 'itemId', value: itemId } });
                continue;
            }

            const qty = new Decimal(record.data.quantity!);
            const price = new Decimal(record.data.unitPrice!);
            const lineTotal = qty.mul(price);
            subtotal = subtotal.add(lineTotal);

            itemsData.push({ itemId: dbItemId, description: record.data.description || null, quantity: qty, unitPrice: price, taxPercent: new Decimal(0), discountPercent: new Decimal(0), lineTotal });
        }

        if (itemsData.length === 0) return;

        const poNumber = `PO-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

        await (prisma as any).purchaseOrder.create({
            data: {
                poNumber, vendorId: vendor.id, orderType, goodsType,
                expectedDeliveryDate, notes, status: 'OPEN',
                subtotal, taxAmount: new Decimal(0), discountAmount: new Decimal(0), totalAmount: subtotal,
                items: { create: itemsData },
            },
        });

        progress.successRecords++;
    }
}
