import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { AllianceCsvParserService, AllianceParsedRecord } from '../../common/services/alliance-csv-parser.service';
import { AllianceValidatorService } from '../../common/services/alliance-validator.service';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { BaseUploadProcessor, BaseUploadProgress } from '../../common/processors/base-upload.processor';

@Processor('alliance-upload')
export class AllianceUploadProcessor extends BaseUploadProcessor<AllianceParsedRecord> {
    constructor(
        csvParser: AllianceCsvParserService,
        validator: AllianceValidatorService,
        eventsService: UploadEventsService,
        notificationsService: NotificationsService,
    ) {
        super(csvParser, validator, eventsService, notificationsService, 'alliance');
    }

    @Process()
    override async handleUpload(job: Job<any>): Promise<void> {
        return super.handleUpload(job);
    }

    /**
     * Process a batch: group rows by alliance code, upsert the alliance, then
     * append the BIN to its binNumbers array.
     *
     * Template rows: one row per BIN. Multiple rows share the same alliance name
     * (and account code). We group them so we create/update the alliance once and
     * collect all BINs together.
     */
    protected async processBatch(
        batch: AllianceParsedRecord[],
        progress: BaseUploadProgress,
        prisma: PrismaService,
    ): Promise<void> {
        // Group rows by alliance name (case-insensitive) to collect all BINs
        const allianceMap = new Map<string, {
            records: AllianceParsedRecord[];
            bins: string[];
        }>();

        for (const record of batch) {
            const key = (record.data.allianceName || '').trim().toUpperCase();
            if (!key) {
                progress.failedRecords++;
                progress.errors.push({ row: record.row, reason: 'Alliance name is empty', data: record.data });
                progress.processedRecords++;
                continue;
            }

            const bin = this.validator.parseBin(record.data.binNumber || '');
            if (!bin) {
                progress.failedRecords++;
                progress.errors.push({ row: record.row, reason: `Invalid BIN: ${record.data.binNumber}`, data: record.data });
                progress.processedRecords++;
                continue;
            }

            if (!allianceMap.has(key)) {
                allianceMap.set(key, { records: [], bins: [] });
            }
            const entry = allianceMap.get(key)!;
            entry.records.push(record);
            if (!entry.bins.includes(bin)) entry.bins.push(bin);
            progress.processedRecords++;
        }

        // Upsert each alliance group
        for (const [allianceKey, { records, bins }] of allianceMap) {
            const representative = records[0];
            const data = representative.data;

            // Derive a short unique code from account code or alliance name
            const code = (data.accountCode || allianceKey)
                .toUpperCase()
                .replace(/[^A-Z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 30);

            const discountPercent = this.extractDiscountPercent(data.allianceName || '');
            const maxDiscount = this.validator.parseCapping(data.discountCapping || '');
            const endDate = this.validator.parseExpiry(data.expiry || '');

            try {
                // Check if alliance with this code already exists
                const existing = await prisma.allianceDiscount.findUnique({ where: { code } });

                if (existing) {
                    // Merge new BINs into existing array
                    const mergedBins = Array.from(new Set([...existing.binNumbers, ...bins]));
                    await prisma.allianceDiscount.update({
                        where: { code },
                        data: {
                            binNumbers: mergedBins,
                            ...(endDate && { endDate }),
                            ...(maxDiscount !== null && { maxDiscount }),
                        },
                    });
                } else {
                    await prisma.allianceDiscount.create({
                        data: {
                            partnerName: data.bank || data.allianceName || allianceKey,
                            code,
                            discountPercent: discountPercent ?? 0,
                            maxDiscount: maxDiscount ?? undefined,
                            description: data.allianceName || undefined,
                            endDate: endDate ?? undefined,
                            binNumbers: bins,
                            isActive: true,
                        },
                    });
                }
                progress.successRecords += records.length;
            } catch (error) {
                this.logger.error(`Failed to upsert alliance "${allianceKey}": ${error.message}`);
                progress.failedRecords += records.length;
                for (const r of records) {
                    progress.errors.push({ row: r.row, reason: error.message, data: r.data });
                }
            }
        }
    }

    /**
     * Extract discount percentage from alliance name string.
     * e.g. "HBL - 25% and Rs. 30,000 Capping" → 25
     */
    private extractDiscountPercent(name: string): number | null {
        const match = name.match(/(\d+(?:\.\d+)?)\s*%/);
        return match ? parseFloat(match[1]) : null;
    }
}
