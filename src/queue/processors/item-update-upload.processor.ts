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
        // 1. Extract non-empty barcodes
        const barcodes = batch.map(r => r.data.barCode).filter(Boolean) as string[];
        if (barcodes.length === 0) {
            for (const record of batch) {
                progress.failedRecords++;
                progress.errors.push({
                    row: record.row,
                    reason: 'Barcode is required',
                    data: record.data,
                });
                progress.processedRecords++;
            }
            return;
        }

        // 2. Fetch existing items in bulk by barcode
        const existingItems = await prisma.item.findMany({
            where: { barCode: { in: barcodes } },
            select: { id: true, barCode: true }
        });

        // Map trimmed barcodes to internal database item IDs
        const barcodeToIdMap = new Map<string, string>();
        for (const item of existingItems) {
            if (item.barCode) {
                barcodeToIdMap.set(item.barCode.trim(), item.id);
            }
        }

        const validRecordsInBatch: { record: ItemUpdateParsedRecord, itemId: string, payload: any }[] = [];

        for (const record of batch) {
            const { barCode, salePrice, fob, taxRate1, taxRate2 } = record.data;

            if (!barCode) {
                progress.failedRecords++;
                progress.errors.push({
                    row: record.row,
                    reason: 'Barcode is required',
                    data: record.data,
                });
                progress.processedRecords++;
                continue;
            }

            const trimmedBarcode = barCode.trim();
            const itemId = barcodeToIdMap.get(trimmedBarcode);

            if (!itemId) {
                progress.failedRecords++;
                progress.errors.push({
                    row: record.row,
                    reason: `Barcode "${barCode}" not found in database`,
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

            validRecordsInBatch.push({ record, itemId, payload });
            progress.processedRecords++;
        }

        // 3. Batch Update Operations inside a database Transaction
        if (validRecordsInBatch.length > 0) {
            try {
                const transactionPromises = validRecordsInBatch.map(item =>
                    prisma.item.update({
                        where: { id: item.itemId },
                        data: item.payload,
                    })
                );
                await prisma.$transaction(transactionPromises);
                progress.successRecords += validRecordsInBatch.length;
            } catch (error) {
                this.logger.error(`Batch transaction update failed: ${error.message}. Retrying individually...`);
                // Fallback to row-by-row updates for isolation of errors
                for (const item of validRecordsInBatch) {
                    try {
                        await prisma.item.update({
                            where: { id: item.itemId },
                            data: item.payload,
                        });
                        progress.successRecords++;
                    } catch (err) {
                        this.logger.error(`Individual update failed for row ${item.record.row}: ${err.message}`);
                        progress.failedRecords++;
                        progress.errors.push({
                            row: item.record.row,
                            reason: `Update failed: ${err.message}`,
                            data: item.record.data,
                        });
                    }
                }
            }
        }
    }
}
