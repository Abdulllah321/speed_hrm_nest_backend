import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import {
    SalesHistoryCsvParserService,
    SalesHistoryParsedRecord,
} from '../../common/services/sales-history-csv-parser.service';
import { SalesHistoryValidatorService } from '../../common/services/sales-history-validator.service';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { NotificationsService } from '../../notifications/notifications.service';
import * as fs from 'fs';
import * as path from 'path';

export interface SalesHistoryUploadProgress {
    totalRecords: number;
    processedRecords: number;
    successRecords: number;
    failedRecords: number;
    skippedRecords: number;
    errors: Array<{ row: number; reason: string; data: any }>;
}

/**
 * Groups raw line-item rows by DocumentNumber so that multi-item orders
 * (Sale7 has 4 rows) are created as a single SalesOrder with multiple items.
 */
interface OrderGroup {
    documentNumber: string;
    rows: SalesHistoryParsedRecord[];
}

@Processor('sales-history-upload')
export class SalesHistoryUploadProcessor {
    private readonly logger = new Logger(SalesHistoryUploadProcessor.name);

    constructor(
        private readonly csvParser: SalesHistoryCsvParserService,
        private readonly validator: SalesHistoryValidatorService,
        private readonly eventsService: UploadEventsService,
        private readonly notificationsService: NotificationsService,
    ) {}

    @Process()
    async handleUpload(job: Job<any>): Promise<void> {
        let { uploadId, fileBuffer, filename, userId, tenantId, tenantDbUrl, mode,
              posId, terminalId, locationId } = job.data;
        mode = mode || 'import';

        this.logger.log(
            `[Job ${job.id}] Sales History ${mode.toUpperCase()} started for ${filename} (Upload: ${uploadId})`,
        );

        // Reconstruct Buffer if serialised through Bull
        if (fileBuffer && (fileBuffer as any).type === 'Buffer' && Array.isArray((fileBuffer as any).data)) {
            fileBuffer = Buffer.from((fileBuffer as any).data);
        }

        // Recover from disk if buffer is missing (import phase)
        if (!fileBuffer) {
            const ext = filename.split('.').pop();
            const filePath = path.join(
                process.cwd(),
                'uploads',
                'bulk',
                'sales-history',
                `sales-history-upload-${uploadId}.${ext}`,
            );
            if (fs.existsSync(filePath)) {
                this.logger.log(`[Job ${job.id}] Recovering file from disk: ${filePath}`);
                fileBuffer = fs.readFileSync(filePath);
            } else {
                this.logger.error(`[Job ${job.id}] CRITICAL: File not found at ${filePath}`);
                throw new Error(`File buffer missing and not found on disk at ${filePath}`);
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
                    message:
                        mode === 'validate'
                            ? 'Starting Sales History Validation...'
                            : 'Starting Sales History Import...',
                },
            });

            const progress: SalesHistoryUploadProgress = {
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

            // ── VALIDATE MODE ──────────────────────────────────────────────
            if (mode === 'validate') {
                this.eventsService.emit({
                    uploadId,
                    type: 'status',
                    data: { message: 'Streaming sales history validation scan...' },
                });

                let validationBatch: SalesHistoryParsedRecord[] = [];
                const allValidationErrors: any[] = [];
                const docNumberSet = new Set<string>(); // track duplicate doc numbers

                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record) => {
                    totalRecordsCount++;

                    // Duplicate DocumentNumber detection (within file)
                    // Note: same DocumentNumber on multiple rows is EXPECTED (multi-item order)
                    // so we only flag if the same barCode appears twice under the same DocumentNumber
                    const dupKey = `${record.data.documentNumber}::${record.data.barCode}`;
                    if (record.data.documentNumber && record.data.barCode) {
                        if (docNumberSet.has(dupKey)) {
                            allValidationErrors.push({
                                row: record.row,
                                field: 'barCode',
                                value: record.data.barCode,
                                reason: `Duplicate barCode "${record.data.barCode}" under DocumentNumber "${record.data.documentNumber}".`,
                            });
                        } else {
                            docNumberSet.add(dupKey);
                        }
                    }

                    validationBatch.push(record);

                    if (validationBatch.length >= 1000) {
                        const batchErrors = this.validator.validateRecords(validationBatch);
                        allValidationErrors.push(...batchErrors);
                        successRecordsCount += validationBatch.length - batchErrors.length;
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
                                    message: `Validating: ${totalRecordsCount} rows scanned...`,
                                },
                            });
                        }
                    }
                });

                // Flush remaining
                if (validationBatch.length > 0) {
                    const batchErrors = this.validator.validateRecords(validationBatch);
                    allValidationErrors.push(...batchErrors);
                    successRecordsCount += validationBatch.length - batchErrors.length;
                }

                docNumberSet.clear();

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
                    title: 'Sales History Validation Completed',
                    message: `Validation finished: ${successRecordsCount} valid rows, ${allValidationErrors.length} invalid.`,
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

            // ── IMPORT MODE ────────────────────────────────────────────────
            this.logger.log(`[Job ${job.id}] Starting Streaming Sales History Import for ${uploadId}`);

            const uploadRecord = await prisma.bulkUpload.findUnique({
                where: { id: uploadId },
                select: { errors: true, totalRecords: true },
            });

            const allValidationErrors = (
                Array.isArray(uploadRecord?.errors) ? uploadRecord.errors : []
            ) as any[];
            const invalidRows = new Set(allValidationErrors.map((e) => e.row));
            const totalToBeProcessed = (uploadRecord?.totalRecords || 0) - invalidRows.size;

            progress.totalRecords = uploadRecord?.totalRecords || 0;
            progress.failedRecords = invalidRows.size;
            progress.errors = allValidationErrors.map((e) => ({
                row: e.row,
                reason: `${e.field}: ${e.reason}`,
                data: { field: e.field, value: e.value },
            }));

            const startTime = Date.now();

            // Collect all valid rows first, then group by DocumentNumber
            // We need to group because one order = multiple rows (multi-item)
            // Buffer is manageable — typical sales history files are <100k rows
            const allValidRows: SalesHistoryParsedRecord[] = [];

            await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record) => {
                totalRecordsCount++;
                if (!invalidRows.has(record.row)) {
                    allValidRows.push(record);
                }
            });

            // Group rows by DocumentNumber
            const orderGroups = new Map<string, SalesHistoryParsedRecord[]>();
            for (const row of allValidRows) {
                const key = row.data.documentNumber || `__row_${row.row}`;
                if (!orderGroups.has(key)) orderGroups.set(key, []);
                orderGroups.get(key)!.push(row);
            }

            this.logger.log(
                `[Job ${job.id}] Grouped ${allValidRows.length} rows into ${orderGroups.size} orders`,
            );

            // Process in batches of 50 orders at a time
            const BATCH_SIZE = 50;
            const groups = Array.from(orderGroups.entries());

            for (let i = 0; i < groups.length; i += BATCH_SIZE) {
                const batch = groups.slice(i, i + BATCH_SIZE);
                await this.processOrderBatch(batch, progress, uploadId, prisma, { posId, terminalId, locationId });

                // Yield to event loop
                await new Promise((resolve) => setImmediate(resolve));

                const now = Date.now();
                if (now - lastEmitTime > 100) {
                    lastEmitTime = now;
                    const elapsedSec = (now - startTime) / 1000;
                    const recsPerSec = Math.round(progress.processedRecords / (elapsedSec || 1));
                    const memoryUsageMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
                    const currentProgress =
                        totalToBeProcessed > 0
                            ? Math.round((progress.processedRecords / totalToBeProcessed) * 100)
                            : 0;

                    if (now % 5000 < 200) {
                        await prisma.bulkUpload.update({
                            where: { id: uploadId },
                            data: {
                                processedRecords: progress.processedRecords,
                                successRecords: progress.successRecords,
                                failedRecords: progress.failedRecords,
                                message: `Importing: ${progress.processedRecords} rows @ ${recsPerSec} recs/s`,
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

            await prisma.bulkUpload.update({
                where: { id: uploadId },
                data: {
                    status: 'completed',
                    processedRecords: progress.processedRecords,
                    successRecords: progress.successRecords,
                    failedRecords: progress.failedRecords,
                    message: `Sales history import completed: ${progress.successRecords} orders created.`,
                    completedAt: new Date(),
                },
            });

            await this.notificationsService.create({
                userId,
                title: 'Sales History Import Completed',
                message: `Import finished: ${progress.successRecords} orders created, ${progress.failedRecords} failed.`,
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
                    data: {
                        status: 'failed',
                        completedAt: new Date(),
                        message: `Error: ${error.message}`,
                    },
                });

                await this.notificationsService.create({
                    userId,
                    title: 'Sales History Import Failed',
                    message: `The sales history ${mode} job failed: ${error.message}`,
                    category: 'system',
                    priority: 'urgent',
                    channels: ['inApp'],
                });

                this.eventsService.emit({
                    uploadId,
                    type: 'failed',
                    data: { message: error.message },
                });
            } catch (e) {
                this.logger.error(`Failed to update failure status: ${e.message}`);
            }
        } finally {
            await prisma.$disconnect();
        }
    }

    /**
     * Process a batch of order groups.
     * Each group = one DocumentNumber = one SalesOrder with N items.
     */
    private async processOrderBatch(
        batch: [string, SalesHistoryParsedRecord[]][],
        progress: SalesHistoryUploadProgress,
        uploadId: string,
        prisma: PrismaService,
        terminalCtx: { posId?: string; terminalId?: string; locationId?: string } = {},
    ): Promise<void> {
        // Collect all barcodes in this batch for a single bulk lookup
        const allBarCodes = [
            ...new Set(
                batch.flatMap(([, rows]) =>
                    rows.map((r) => r.data.barCode).filter(Boolean) as string[],
                ),
            ),
        ];

        // Bulk item lookup by barCode
        const items = await prisma.item.findMany({
            where: { barCode: { in: allBarCodes } },
            select: { id: true, barCode: true, unitPrice: true, taxRate1: true },
        });
        const itemByBarCode = new Map(items.map((i) => [i.barCode!, i]));

        // Also try by itemId (some barcodes may be stored as itemId)
        const missingBarCodes = allBarCodes.filter((bc) => !itemByBarCode.has(bc));
        if (missingBarCodes.length > 0) {
            const byItemId = await prisma.item.findMany({
                where: { itemId: { in: missingBarCodes } },
                select: { id: true, barCode: true, itemId: true, unitPrice: true, taxRate1: true },
            });
            for (const item of byItemId) {
                // Index by the barCode we searched for (which was the itemId)
                const searchedAs = missingBarCodes.find((bc) => bc === item.itemId);
                if (searchedAs) itemByBarCode.set(searchedAs, item);
            }
        }

        // Check which DocumentNumbers already exist to avoid duplicates
        const docNumbers = batch.map(([docNum]) => docNum);
        const existingOrders = await prisma.salesOrder.findMany({
            where: { orderNumber: { in: docNumbers } },
            select: { orderNumber: true },
        });
        const existingSet = new Set(existingOrders.map((o) => o.orderNumber));

        for (const [documentNumber, rows] of batch) {
            // Count all rows in this group as processed
            progress.processedRecords += rows.length;

            if (existingSet.has(documentNumber)) {
                this.logger.warn(`Order "${documentNumber}" already exists — skipping.`);
                progress.skippedRecords += rows.length;
                progress.errors.push({
                    row: rows[0].row,
                    reason: `Order "${documentNumber}" already exists in the database.`,
                    data: { documentNumber },
                });
                continue;
            }

            try {
                // Use the first row for order-level fields
                const firstRow = rows[0].data;

                // Resolve order date
                let createdAt: Date | undefined;
                if (firstRow.documentDate) {
                    const d = new Date(firstRow.documentDate);
                    if (!isNaN(d.getTime())) createdAt = d;
                }

                // Determine payment method and amounts from tender columns
                const cashSale = firstRow.cashSale || 0;
                const cardSale = firstRow.cardSale || 0;
                const giftVoucher = firstRow.giftVoucherAmount || 0;
                const creditVoucher = firstRow.creditVoucherAmount || 0;
                const exchangeVoucher = firstRow.exchangeVoucherAmount || 0;
                const onCredit = firstRow.onCreditAmount || 0;

                const totalPaid = cashSale + cardSale + giftVoucher + creditVoucher + exchangeVoucher;
                let paymentMethod = 'cash';
                if (cardSale > 0 && cashSale > 0) paymentMethod = 'split';
                else if (cardSale > 0) paymentMethod = 'card';
                else if (giftVoucher > 0 || creditVoucher > 0 || exchangeVoucher > 0) paymentMethod = 'voucher';
                else if (onCredit > 0) paymentMethod = 'credit_account';

                // Build line items
                const lineItems: {
                    itemId: string;
                    quantity: number;
                    unitPrice: number;
                    discountPercent: number;
                    discountAmount: number;
                    taxPercent: number;
                    taxAmount: number;
                    lineTotal: number;
                }[] = [];

                let hasItemError = false;

                for (const row of rows) {
                    const d = row.data;
                    const item = d.barCode ? itemByBarCode.get(d.barCode) : null;

                    if (!item) {
                        progress.failedRecords++;
                        progress.errors.push({
                            row: row.row,
                            reason: `Item with barCode "${d.barCode}" not found in the system.`,
                            data: { barCode: d.barCode, documentNumber },
                        });
                        hasItemError = true;
                        continue;
                    }

                    const qty = d.quantity || 1;
                    const unitPrice = d.unitPrice ?? Number(item.unitPrice);
                    const discPct = d.discountPercent || 0;
                    const subtotal = unitPrice * qty;
                    const discAmt = d.discountAmount ?? Math.round(subtotal * (discPct / 100) * 100) / 100;
                    const afterDisc = subtotal - discAmt;
                    const taxPct = Number(item.taxRate1 || 0);
                    const taxAmt = d.salesTax ?? Math.round(afterDisc * (taxPct / 100) * 100) / 100;
                    const lineTotal = d.totalPriceWithTax ?? Math.round((afterDisc + taxAmt) * 100) / 100;

                    lineItems.push({
                        itemId: item.id,
                        quantity: qty,
                        unitPrice,
                        discountPercent: discPct,
                        discountAmount: discAmt,
                        taxPercent: taxPct,
                        taxAmount: taxAmt,
                        lineTotal: Math.max(0, lineTotal),
                    });
                }

                // Skip order if ALL items failed lookup
                if (lineItems.length === 0) {
                    progress.failedRecords += rows.length;
                    continue;
                }

                const subtotal = lineItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
                const totalDiscount = lineItems.reduce((s, i) => s + i.discountAmount, 0);
                const totalTax = lineItems.reduce((s, i) => s + i.taxAmount, 0);
                const grandTotal = lineItems.reduce((s, i) => s + i.lineTotal, 0);

                const paymentStatus =
                    totalPaid >= grandTotal ? 'paid' : totalPaid > 0 ? 'partial' : 'unpaid';

                // FBR invoice — strip leading apostrophe that Excel sometimes adds
                const rawFbr = firstRow.fbrInvoiceNumber;
                const fbrInvoiceNumber = rawFbr ? rawFbr.replace(/^'/, '') : undefined;

                const notesParts: string[] = [];
                if (firstRow.remarks) notesParts.push(firstRow.remarks);
                if (firstRow.isAllianceDiscount) notesParts.push('[Alliance Discount]');
                if (firstRow.salesPerson) notesParts.push(`SP: ${firstRow.salesPerson}`);

                await prisma.salesOrder.create({
                    data: {
                        orderNumber: documentNumber,
                        posId: terminalCtx.posId || undefined,
                        terminalId: terminalCtx.terminalId || undefined,
                        locationId: terminalCtx.locationId || undefined,
                        paymentMethod,
                        paymentStatus,
                        status: 'completed',
                        subtotal,
                        discountAmount: totalDiscount,
                        taxAmount: totalTax,
                        grandTotal,
                        cashAmount: cashSale || undefined,
                        cardAmount: cardSale || undefined,
                        tenderType: paymentMethod,
                        fbrInvoiceNumber: fbrInvoiceNumber || undefined,
                        fbrStatus: fbrInvoiceNumber ? 'SYNCED' : 'PENDING',
                        notes: notesParts.join(' | ') || undefined,
                        createdAt: createdAt || undefined,
                        items: {
                            create: lineItems,
                        },
                    },
                });

                // Count each successfully created line item as a success
                progress.successRecords += lineItems.length;

                // If some items in this order failed lookup, count those as failed
                if (hasItemError) {
                    const failedCount = rows.length - lineItems.length;
                    progress.failedRecords += failedCount;
                }
            } catch (error) {
                this.logger.error(
                    `Failed to create order "${documentNumber}": ${error.message}`,
                );
                progress.failedRecords += rows.length;
                progress.errors.push({
                    row: rows[0].row,
                    reason: `DB error for order "${documentNumber}": ${error.message}`,
                    data: { documentNumber },
                });
            }
        }
    }
}
