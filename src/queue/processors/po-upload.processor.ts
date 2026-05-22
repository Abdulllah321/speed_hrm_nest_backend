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
        let { uploadId, fileBuffer, filename, userId, tenantId, tenantDbUrl, mode, metadata } = job.data;
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

                progress.totalRecords = uploadRecord?.totalRecords || 0;
                progress.failedRecords = invalidRows.size;

                // Collect all valid records
                const validRecords: PoParsedRecord[] = [];

                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record) => {
                    totalRecordsCount++;
                    if (!invalidRows.has(record.row)) validRecords.push(record);
                });

                if (validRecords.length === 0) {
                    throw new Error('No valid records to import');
                }

                try {
                    await this.createPoWithMetadata(metadata, validRecords, progress, prisma);
                } catch (err: any) {
                    this.logger.error(`Failed to create PO: ${err.message}`);
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

                const allParsedRecords: PoParsedRecord[] = [];
                const allValidationErrors: any[] = [];

                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record) => {
                    totalRecordsCount++;
                    allParsedRecords.push(record);

                    const now = Date.now();
                    if (now - lastEmitTime > 2000) {
                        lastEmitTime = now;
                        await job.progress(10);
                        this.eventsService.emit({ uploadId, type: 'progress', data: { progress: 10, status: 'validating', message: `Scanning PO records: ${totalRecordsCount} rows...` } });
                    }
                });

                // 1. Basic field-level validations
                const basicErrors = allParsedRecords.flatMap(r => this.validator.validateRecord(r));
                allValidationErrors.push(...basicErrors);

                // 2. Barcode existence checks against DB
                const barcodes = [...new Set(allParsedRecords.map(r => r.data.barCode?.trim()).filter(Boolean) as string[])];
                const items = barcodes.length > 0
                    ? await (prisma as any).item.findMany({
                        where: { barCode: { in: barcodes } },
                        select: { id: true, barCode: true },
                    })
                    : [];
                const foundBarcodes = new Set(items.map((i: any) => i.barCode?.trim()));

                for (const record of allParsedRecords) {
                    const barCode = record.data.barCode?.trim();
                    if (barCode && !foundBarcodes.has(barCode)) {
                        allValidationErrors.push({
                            row: record.row,
                            field: 'barCode',
                            value: barCode,
                            reason: `BarCode "${barCode}" not found in item master.`,
                        });
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
            } catch (e: any) {
                this.logger.error(`Failed to update failure status: ${e.message}`);
            }
        } finally {
            await prisma.$disconnect();
        }
    }

    private async createPoWithMetadata(metadata: any, records: PoParsedRecord[], progress: PoUploadProgress, prisma: PrismaService): Promise<void> {
        const vendorId = metadata?.vendorId;
        if (!vendorId) throw new Error('Vendor is required for PO import but none was provided.');

        const vendor = await (prisma as any).supplier.findUnique({ where: { id: vendorId } });
        if (!vendor) throw new Error(`Supplier with ID "${vendorId}" not found`);

        const orderType = metadata?.orderType?.toUpperCase() || 'LOCAL';
        const goodsType = metadata?.goodsType?.toUpperCase() || 'CONSUMABLE';

        // Enforce vendor type matches order type
        const mismatch = this.validator.validateVendorOrderTypeMatch(vendor.type || 'LOCAL', orderType);
        if (mismatch) throw new Error(mismatch);

        // Resolve all items by unique barCode in one query
        const barcodes = [...new Set(records.map(r => r.data.barCode?.trim()).filter(Boolean) as string[])];
        const items = barcodes.length > 0
            ? await (prisma as any).item.findMany({
                where: { barCode: { in: barcodes } },
                select: { id: true, barCode: true, description: true, unitCost: true, unitPrice: true },
            })
            : [];
        const itemMap = new Map<string, any>(items.map((i: any) => [i.barCode?.trim(), i]));

        const expectedDeliveryDate = metadata?.expectedDeliveryDate ? new Date(metadata.expectedDeliveryDate) : null;
        const notes = metadata?.notes || null;

        let subtotal = new Decimal(0);
        const itemsData: any[] = [];

        for (const record of records) {
            const barCode = record.data.barCode?.trim();
            const item = barCode ? itemMap.get(barCode) : undefined;
            if (!item) {
                progress.failedRecords++;
                progress.errors.push({ row: record.row, reason: `BarCode "${barCode}" not found in item master`, data: { field: 'barCode', value: barCode } });
                continue;
            }

            const qty = new Decimal(record.data.quantity!);
            // Price resolution: unitCost > 0 ? unitCost : unitPrice
            const unitCost = Number(item.unitCost ?? 0);
            const unitPriceVal = Number(item.unitPrice ?? 0);
            const resolvedPriceVal = unitCost > 0 ? unitCost : unitPriceVal;
            const price = new Decimal(resolvedPriceVal);

            const lineTotal = qty.mul(price);
            subtotal = subtotal.add(lineTotal);

            itemsData.push({
                itemId: item.id,
                description: item.description || null,
                quantity: qty,
                unitPrice: price,
                taxPercent: new Decimal(0),
                discountPercent: new Decimal(0),
                lineTotal,
            });
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
