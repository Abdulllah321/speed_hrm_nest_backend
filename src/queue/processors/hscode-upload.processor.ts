import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { HsCodeCsvParserService, HsCodeParsedRecord } from '../../common/services/hscode-csv-parser.service';
import { HsCodeValidatorService } from '../../common/services/hscode-validator.service';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { BaseUploadProcessor, BaseUploadProgress } from '../../common/processors/base-upload.processor';

@Processor('hscode-upload')
export class HsCodeUploadProcessor extends BaseUploadProcessor<HsCodeParsedRecord> {
    constructor(
        csvParser: HsCodeCsvParserService,
        validator: HsCodeValidatorService,
        eventsService: UploadEventsService,
        notificationsService: NotificationsService,
    ) {
        super(csvParser, validator, eventsService, notificationsService, 'hscode');
    }

    @Process()
    override async handleUpload(job: Job<any>): Promise<void> {
        return super.handleUpload(job);
    }

    /**
     * Process a batch of HS Code records with individual error isolation and bulk operations
     */
    protected async processBatch(
        batch: HsCodeParsedRecord[],
        progress: BaseUploadProgress,
        prisma: PrismaService,
    ): Promise<void> {
        // Bulk existence check for this batch
        const hsCodes = batch.map(r => String(r.data.hsCode)).filter(Boolean);
        const existingHsCodes = await prisma.hsCode.findMany({
            where: { hsCode: { in: hsCodes } },
            select: { hsCode: true }
        });
        const existingSet = new Set(existingHsCodes.map(i => i.hsCode));

        const toCreate: any[] = [];
        
        for (const record of batch) {
            const hsCode = String(record.data.hsCode);
            if (existingSet.has(hsCode)) {
                // Log warning for existing HS Code and count as skipped/failed
                this.logger.warn(`HS Code "${hsCode}" already exists at row ${record.row}. Skipping.`);
                progress.failedRecords++;
                progress.errors.push({
                    row: record.row,
                    reason: `HS Code "${hsCode}" already exists`,
                    data: record.data,
                });
            } else {
                toCreate.push({
                    hsCode: hsCode,
                    customsDutyCd: Number(record.data.customsDutyCd) || 0,
                    regulatoryDutyRd: Number(record.data.regulatoryDutyRd) || 0,
                    additionalCustomsDutyAcd: Number(record.data.additionalCustomsDutyAcd) || 0,
                    salesTax: Number(record.data.salesTax) || 0,
                    additionalSalesTax: 0,
                    incomeTax: Number(record.data.incomeTax) || 0,
                    exciseCharges: 0,
                    status: 'active',
                });
            }
            progress.processedRecords++;
        }

        // Execute Bulk Creation
        if (toCreate.length > 0) {
            try {
                await prisma.hsCode.createMany({
                    data: toCreate,
                    skipDuplicates: true
                });
                progress.successRecords += toCreate.length;
            } catch (error) {
                this.logger.error(`Bulk create of HS Codes failed: ${error.message}`);
                // Fallback to individual
                for (const item of toCreate) {
                    try {
                        await prisma.hsCode.create({ data: item });
                        progress.successRecords++;
                    } catch (e) {
                        progress.failedRecords++;
                    }
                }
            }
        }
    }
}
