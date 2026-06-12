import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { ItemUpdateCsvParserService, ItemUpdateParsedRecord } from '../../common/services/item-update-csv-parser.service';
import { ItemUpdateValidatorService } from '../../common/services/item-update-validator.service';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { BaseUploadProcessor, BaseUploadProgress } from '../../common/processors/base-upload.processor';

@Processor('item-update-upload')
export class ItemUpdateUploadProcessor extends BaseUploadProcessor<ItemUpdateParsedRecord> {
    constructor(
        csvParser: ItemUpdateCsvParserService,
        validator: ItemUpdateValidatorService,
        eventsService: UploadEventsService,
        notificationsService: NotificationsService,
    ) {
        super(csvParser, validator, eventsService, notificationsService, 'item-update');
    }

    @Process()
    override async handleUpload(job: Job<any>): Promise<void> {
        // Critical: Always call super.handleUpload to run the base pipeline
        return super.handleUpload(job);
    }

    /**
     * Entity-Specific Batch Write Implementation
     */
    protected async processBatch(
        batch: ItemUpdateParsedRecord[],
        progress: BaseUploadProgress,
        prisma: PrismaService,
    ): Promise<void> {
        // 1. Extract non-empty barcodes and skus
        const barcodes = batch.map(r => r.data.barCode).filter(Boolean) as string[];
        const skus = batch.map(r => r.data.sku).filter(Boolean) as string[];

        if (barcodes.length === 0 && skus.length === 0) {
            for (const record of batch) {
                progress.failedRecords++;
                progress.errors.push({
                    row: record.row,
                    reason: 'Either Barcode or SKU is required',
                    data: record.data,
                });
                progress.processedRecords++;
            }
            return;
        }

        // 2. Fetch existing items in bulk by barcode and/or SKU
        const orConditions: any[] = [];
        if (barcodes.length > 0) orConditions.push({ barCode: { in: barcodes } });
        if (skus.length > 0) orConditions.push({ sku: { in: skus } });

        const existingItems = await prisma.item.findMany({
            where: { OR: orConditions },
            select: { id: true, barCode: true, sku: true }
        });

        // Map trimmed barcodes and SKUs to internal database items (arrays of items since SKU/barcode can match multiple items)
        const barcodeToItemsMap = new Map<string, typeof existingItems>();
        const skuToItemsMap = new Map<string, typeof existingItems>();
        for (const item of existingItems) {
            if (item.barCode) {
                const cleanBarcode = item.barCode.trim();
                if (!barcodeToItemsMap.has(cleanBarcode)) {
                    barcodeToItemsMap.set(cleanBarcode, []);
                }
                barcodeToItemsMap.get(cleanBarcode)!.push(item);
            }
            if (item.sku) {
                const cleanSku = item.sku.trim();
                if (!skuToItemsMap.has(cleanSku)) {
                    skuToItemsMap.set(cleanSku, []);
                }
                skuToItemsMap.get(cleanSku)!.push(item);
            }
        }

        const validRecordsInBatch: { record: ItemUpdateParsedRecord, itemId: string, payload: any }[] = [];

        for (const record of batch) {
            const { barCode, sku, salePrice, fob, taxRate1, taxRate2 } = record.data;

            if (!barCode && !sku) {
                progress.failedRecords++;
                progress.errors.push({
                    row: record.row,
                    reason: 'Either Barcode or SKU is required',
                    data: record.data,
                });
                progress.processedRecords++;
                continue;
            }

            let matchedItems: typeof existingItems = [];

            // Prefer SKU Code if available
            if (sku) {
                const cleanSku = sku.trim();
                matchedItems = skuToItemsMap.get(cleanSku) || [];
            }

            // Fallback to Barcode if SKU not found or not provided
            if (matchedItems.length === 0 && barCode) {
                const cleanBarcode = barCode.trim();
                matchedItems = barcodeToItemsMap.get(cleanBarcode) || [];
            }

            if (matchedItems.length === 0) {
                progress.failedRecords++;
                progress.errors.push({
                    row: record.row,
                    reason: `Item with Barcode "${barCode || ''}" or SKU "${sku || ''}" not found in database`,
                    data: record.data,
                });
                progress.processedRecords++;
                continue;
            }

            // Construct payload dynamically (only include fields that are actually provided)
            const payload: any = {};
            if (salePrice !== undefined && salePrice !== null) payload.unitPrice = salePrice;
            if (fob !== undefined && fob !== null) payload.fob = fob;
            if (taxRate1 !== undefined && taxRate1 !== null) payload.taxRate1 = taxRate1;
            if (taxRate2 !== undefined && taxRate2 !== null) payload.taxRate2 = taxRate2;

            if (Object.keys(payload).length === 0) {
                progress.skippedRecords++;
                progress.processedRecords++;
                continue;
            }

            for (const matchedItem of matchedItems) {
                validRecordsInBatch.push({ record, itemId: matchedItem.id, payload });
            }
            progress.processedRecords++;
        }

        // 3. Batch Update Operations inside database Transactions (chunked to avoid timeouts)
        if (validRecordsInBatch.length > 0) {
            const chunkSize = 200;
            for (let i = 0; i < validRecordsInBatch.length; i += chunkSize) {
                const chunk = validRecordsInBatch.slice(i, i + chunkSize);
                try {
                    const transactionPromises = chunk.map(item =>
                        prisma.item.update({
                            where: { id: item.itemId },
                            data: item.payload,
                        })
                    );
                    await prisma.$transaction(transactionPromises);
                    
                    // Since multiple updates can belong to the same CSV row, count unique rows successfully updated in this chunk
                    const uniqueRowNumbers = new Set(chunk.map(x => x.record.row));
                    progress.successRecords += uniqueRowNumbers.size;
                } catch (error) {
                    this.logger.error(`Batch transaction update failed for chunk ${i / chunkSize + 1}: ${error.message}. Retrying chunk individually...`);
                    // Fallback to row-by-row updates for isolation of errors
                    // Group the chunk's valid item updates by their original CSV row
                    const rowsGrouped = new Map<number, typeof chunk>();
                    for (const item of chunk) {
                        const row = item.record.row;
                        if (!rowsGrouped.has(row)) {
                            rowsGrouped.set(row, []);
                        }
                        rowsGrouped.get(row)!.push(item);
                    }

                    for (const [row, items] of rowsGrouped) {
                        try {
                            const promises = items.map(item =>
                                prisma.item.update({
                                    where: { id: item.itemId },
                                    data: item.payload,
                                })
                            );
                            await prisma.$transaction(promises);
                            progress.successRecords++;
                        } catch (err) {
                            this.logger.error(`Individual update failed for row ${row}: ${err.message}`);
                            progress.failedRecords++;
                            progress.errors.push({
                                row: row,
                                reason: `Update failed: ${err.message}`,
                                data: items[0].record.data,
                            });
                        }
                    }
                }
            }
        }
    }
}
