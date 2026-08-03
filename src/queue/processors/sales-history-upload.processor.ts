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
import { PosSalesService } from '../../pos-sales/pos-sales.service';
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

function parseDocumentDate(rawDate: any): Date | undefined {
    if (!rawDate) return undefined;

    // Handle Excel date serial numbers like 45839 (7/1/2025)
    if (typeof rawDate === 'number' || (!isNaN(Number(rawDate)) && !String(rawDate).includes('/') && !String(rawDate).includes('-'))) {
        const num = Number(rawDate);
        if (num > 30000 && num < 70000) {
            const excelEpoch = new Date(Date.UTC(1899, 11, 30));
            return new Date(excelEpoch.getTime() + num * 86400000);
        }
    }

    const str = String(rawDate).trim();
    if (!str) return undefined;

    // Handle M/D/YYYY or D/M/YYYY (e.g. 7/1/2025)
    const parts = str.split(/[/.\-]/);
    if (parts.length === 3) {
        let p1 = parseInt(parts[0], 10);
        let p2 = parseInt(parts[1], 10);
        let p3 = parseInt(parts[2], 10);

        if (p3 > 1900 && p3 < 2100) {
            const date = new Date(Date.UTC(p3, p1 - 1, p2, 12, 0, 0));
            if (!isNaN(date.getTime())) return date;
        }
        if (p1 > 1900 && p1 < 2100) {
            const date = new Date(Date.UTC(p1, p2 - 1, p3, 12, 0, 0));
            if (!isNaN(date.getTime())) return date;
        }
    }

    const fallback = new Date(str);
    return !isNaN(fallback.getTime()) ? fallback : undefined;
}

@Processor('sales-history-upload')
export class SalesHistoryUploadProcessor {
    private readonly logger = new Logger(SalesHistoryUploadProcessor.name);

    constructor(
        private readonly csvParser: SalesHistoryCsvParserService,
        private readonly validator: SalesHistoryValidatorService,
        private readonly eventsService: UploadEventsService,
        private readonly notificationsService: NotificationsService,
        private readonly posSalesService: PosSalesService,
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
            const locSequenceMap = new Map<string, { prefix: string; currentSeq: number }>();

            for (let i = 0; i < groups.length; i += BATCH_SIZE) {
                const batch = groups.slice(i, i + BATCH_SIZE);
                await this.processOrderBatch(batch, progress, uploadId, prisma, { posId, terminalId, locationId }, locSequenceMap);

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

            // Detect missing sequence numbers from uploaded DocumentNumbers
            const docNums = groups
                .map(([docNum]) => docNum.replace(/[^0-9]/g, ''))
                .filter(Boolean)
                .map((numStr) => parseInt(numStr, 10))
                .filter((n) => !isNaN(n));

            if (docNums.length > 1) {
                const minDoc = Math.min(...docNums);
                const maxDoc = Math.max(...docNums);
                const uploadedSet = new Set(docNums);
                const missingDocs: number[] = [];

                for (let i = minDoc; i <= maxDoc; i++) {
                    if (!uploadedSet.has(i)) {
                        missingDocs.push(i);
                    }
                }

                if (missingDocs.length > 0) {
                    this.logger.warn(
                        `[SEQUENCE GAP DETECTED] Missing ${missingDocs.length} sequence numbers between #${minDoc} and #${maxDoc}: ${missingDocs.slice(0, 20).join(', ')}${missingDocs.length > 20 ? '...' : ''}`,
                    );
                    for (const missing of missingDocs) {
                        progress.errors.push({
                            row: 0,
                            reason: `[SEQUENCE GAP] DocumentNumber #${missing} is missing between #${minDoc} and #${maxDoc} in uploaded file sequence.`,
                            data: { documentNumber: String(missing), value: 'MISSING_IN_SEQUENCE' },
                        });
                    }
                }
            }

            await prisma.bulkUpload.update({
                where: { id: uploadId },
                data: {
                    status: 'completed',
                    processedRecords: progress.processedRecords,
                    successRecords: progress.successRecords,
                    failedRecords: progress.failedRecords,
                    errors: progress.errors as any,
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
     * High-speed optimized: in-memory location resolution & sequential number generation, plus Override on existing orders.
     */
    private async processOrderBatch(
        batch: [string, SalesHistoryParsedRecord[]][],
        progress: SalesHistoryUploadProgress,
        uploadId: string,
        prisma: PrismaService,
        terminalCtx: { posId?: string; terminalId?: string; locationId?: string } = {},
        locSequenceMap: Map<string, { prefix: string; currentSeq: number }> = new Map(),
    ): Promise<void> {
        // 1. Bulk item lookup by barCode & itemId
        const allBarCodes = [
            ...new Set(
                batch.flatMap(([, rows]) =>
                    rows.map((r) => r.data.barCode).filter(Boolean) as string[],
                ),
            ),
        ];

        const items = await prisma.item.findMany({
            where: { barCode: { in: allBarCodes } },
            select: { id: true, barCode: true, unitPrice: true, taxRate1: true },
        });
        const itemByBarCode = new Map(items.map((i) => [i.barCode!, i]));

        const missingBarCodes = allBarCodes.filter((bc) => !itemByBarCode.has(bc));
        if (missingBarCodes.length > 0) {
            const byItemId = await prisma.item.findMany({
                where: { itemId: { in: missingBarCodes } },
                select: { id: true, barCode: true, itemId: true, unitPrice: true, taxRate1: true },
            });
            for (const item of byItemId) {
                const searchedAs = missingBarCodes.find((bc) => bc === item.itemId);
                if (searchedAs) itemByBarCode.set(searchedAs, item);
            }
        }

        // 2. Pre-fetch all locations in memory for instant zero-query resolution
        const allLocations = await prisma.location.findMany({
            where: { isDeleted: false },
            select: { id: true, name: true, code: true, shortCode: true, status: true },
        });

        const defaultLocationId =
            (terminalCtx.locationId && allLocations.find((l) => l.id === terminalCtx.locationId)?.id) ||
            allLocations.find((l) => l.status === 'active')?.id ||
            allLocations[0]?.id;

        const resolveLocInMem = (costCentre?: string): string | undefined => {
            if (costCentre) {
                const cleanCC = costCentre.trim().toLowerCase();
                for (const loc of allLocations) {
                    if (
                        loc.name.toLowerCase() === cleanCC ||
                        loc.code.toLowerCase() === cleanCC ||
                        (loc.shortCode && loc.shortCode.toLowerCase() === cleanCC)
                    ) {
                        return loc.id;
                    }
                }
                const normCC = cleanCC.replace(/[^a-z0-9]/g, '');
                for (const loc of allLocations) {
                    const normName = loc.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (normName === normCC || normName.includes(normCC) || normCC.includes(normName)) {
                        return loc.id;
                    }
                }
            }
            return defaultLocationId;
        };

        // 3. Pre-fetch existing orders for Override / Upsert support
        const docNumbers = batch.map(([docNum]) => docNum);
        const orConditions: any[] = [];
        for (const d of docNumbers) {
            orConditions.push({ orderNumber: { equals: d, mode: 'insensitive' } });
            orConditions.push({ notes: { startsWith: `Ref: ${d} |`, mode: 'insensitive' } });
            orConditions.push({ notes: { equals: `Ref: ${d}`, mode: 'insensitive' } });
        }

        const existingOrders = await prisma.salesOrder.findMany({
            where: { OR: orConditions },
            select: { id: true, orderNumber: true, notes: true },
        });

        const existingOrderByDocNum = new Map<string, { id: string; orderNumber: string }>();
        for (const order of existingOrders) {
            for (const docNum of docNumbers) {
                const isExactRef = order.notes && (
                    order.notes === `Ref: ${docNum}` ||
                    order.notes.startsWith(`Ref: ${docNum} |`)
                );
                if (
                    order.orderNumber.toUpperCase() === docNum.toUpperCase() ||
                    isExactRef
                ) {
                    existingOrderByDocNum.set(docNum, { id: order.id, orderNumber: order.orderNumber });
                }
            }
        }

        // 4. Pre-fetch next sequential order numbers in memory for each location (persist across batches)
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const fiscalYearStartYear = month >= 6 ? year : year - 1;
        const fySuffix = String(fiscalYearStartYear).slice(-2);
        const fiscalYearStartDate = new Date(Date.UTC(fiscalYearStartYear, 6, 1, 0, 0, 0, 0));

        const distinctLocIds = new Set<string>();
        for (const [, rows] of batch) {
            const locId = resolveLocInMem(rows[0]?.data?.costCentre) || defaultLocationId;
            if (locId) distinctLocIds.add(locId);
        }

        for (const locId of distinctLocIds) {
            if (!locSequenceMap.has(locId)) {
                const loc = allLocations.find((l) => l.id === locId);
                let rawCode = loc?.shortCode?.trim() || loc?.name || 'LOC';
                let cleanCode = rawCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'LOC';
                const matchPrefix = `SI-${cleanCode}${fySuffix}-`;

                const existingOrderNums = await prisma.salesOrder.findMany({
                    where: {
                        locationId: locId,
                        createdAt: { gte: fiscalYearStartDate },
                        orderNumber: { startsWith: matchPrefix },
                    },
                    select: { orderNumber: true },
                });

                let maxSeq = 0;
                for (const o of existingOrderNums) {
                    const parts = o.orderNumber.split('-');
                    const lastPart = parts[parts.length - 1];
                    if (/^\d+$/.test(lastPart)) {
                        const parsed = parseInt(lastPart, 10);
                        if (parsed > maxSeq) maxSeq = parsed;
                    }
                }
                locSequenceMap.set(locId, { prefix: matchPrefix, currentSeq: maxSeq + 1 });
            }
        }

        const generateOrderNumberInMem = (locId?: string, docNum?: string): string => {
            if (!locId) return docNum || 'SO-00001';
            const entry = locSequenceMap.get(locId);
            if (!entry) return docNum || 'SO-00001';
            const num = `${entry.prefix}${String(entry.currentSeq).padStart(5, '0')}`;
            entry.currentSeq++;
            return num;
        };

        // 5. Execute processing loop
        for (const [documentNumber, rows] of batch) {
            progress.processedRecords += rows.length;

            try {
                const firstRow = rows[0].data;
                const targetLocationId = resolveLocInMem(firstRow.costCentre) || defaultLocationId;

                const existingEntry = existingOrderByDocNum.get(documentNumber);
                let orderNumber: string;
                if (existingEntry) {
                    orderNumber = existingEntry.orderNumber;
                } else {
                    orderNumber = generateOrderNumberInMem(targetLocationId, documentNumber);
                }

                const createdAt = parseDocumentDate(firstRow.documentDate);

                const cashSale = firstRow.cashSale || 0;
                const cardSale = firstRow.cardSale || 0;
                const giftVoucher = (firstRow.giftVoucherAmount || 0) + (firstRow.giftVoucherCorporate || 0);
                const creditVoucher = firstRow.creditVoucherAmount || 0;
                const exchangeVoucher = firstRow.exchangeVoucherAmount || 0;
                const claimVoucher = firstRow.claimVoucherAmount || 0;
                const rewardVoucher = firstRow.rewardVoucherAmount || 0;
                const onCredit = (firstRow.onCreditAmount || 0) + (firstRow.creditSale || 0);

                const voucherAmount = giftVoucher + creditVoucher + exchangeVoucher + claimVoucher + rewardVoucher;
                const totalPaid = cashSale + cardSale + voucherAmount;

                let paymentMethod = 'cash';
                if ((cardSale > 0 && cashSale > 0) || (cardSale > 0 && voucherAmount > 0) || (cashSale > 0 && voucherAmount > 0)) {
                    paymentMethod = 'split';
                } else if (cardSale > 0) {
                    paymentMethod = 'card';
                } else if (voucherAmount > 0) {
                    paymentMethod = 'voucher';
                } else if (onCredit > 0) {
                    paymentMethod = 'credit_account';
                }

                const lineItems: {
                    itemId: string;
                    quantity: number;
                    unitPrice: number;
                    discountPercent: number;
                    discountAmount: number;
                    taxPercent: number;
                    taxAmount: number;
                    lineTotal: number;
                    totalWost: number;
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
                    const itemMasterTax = Number(item.taxRate1 || 0);

                    let taxPct = itemMasterTax;
                    if (d.salesTax !== undefined && d.totalPriceWithoutTax && (d.totalPriceWithoutTax - (d.discountAmount || 0)) > 0) {
                        taxPct = Math.round((d.salesTax / (d.totalPriceWithoutTax - (d.discountAmount || 0))) * 100 * 100) / 100;
                    }

                    const taxDivisor = 1 + taxPct / 100;
                    const wostPerUnit = unitPrice / taxDivisor;
                    const totalWost = d.totalPriceWithoutTax ?? Math.round(wostPerUnit * qty * 100) / 100;

                    const discPct = d.discountPercent || 0;
                    const discAmt = d.discountAmount ?? Math.round(totalWost * (discPct / 100) * 100) / 100;
                    const afterDisc = totalWost - discAmt;
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
                        totalWost,
                    });
                }

                if (lineItems.length === 0) {
                    progress.failedRecords += rows.length;
                    continue;
                }

                const subtotal = lineItems.reduce((s, i) => s + i.totalWost, 0);
                const totalDiscount = lineItems.reduce((s, i) => s + i.discountAmount, 0);
                const totalTax = lineItems.reduce((s, i) => s + i.taxAmount, 0);
                const grandTotal = lineItems.reduce((s, i) => s + i.lineTotal, 0);

                const paymentStatus =
                    totalPaid >= grandTotal ? 'paid' : totalPaid > 0 ? 'partial' : 'unpaid';

                const rawFbr = firstRow.fbrInvoiceNumber;
                const fbrInvoiceNumber = rawFbr ? rawFbr.replace(/^'/, '') : undefined;

                const notesParts: string[] = [];
                if (firstRow.documentNumber) notesParts.push(`Ref: ${firstRow.documentNumber}`);
                if (firstRow.fkExchangeVoucherNumber) notesParts.push(`ExVoucher: ${firstRow.fkExchangeVoucherNumber}`);
                if (firstRow.costCentre) notesParts.push(`CostCentre: ${firstRow.costCentre}`);
                if (firstRow.remarks) notesParts.push(firstRow.remarks);
                if (firstRow.isAllianceDiscount) notesParts.push('[Alliance Discount]');
                if (firstRow.salesPerson) notesParts.push(`SP: ${firstRow.salesPerson}`);

                let salesOrderId: string;

                if (existingEntry) {
                    salesOrderId = existingEntry.id;
                    // Delete previous items to replace with updated line items
                    await prisma.salesOrderItem.deleteMany({
                        where: { salesOrderId },
                    });

                    // Update existing sales order
                    await prisma.salesOrder.update({
                        where: { id: salesOrderId },
                        data: {
                            paymentMethod,
                            paymentStatus,
                            status: 'completed',
                            subtotal,
                            discountAmount: totalDiscount,
                            taxAmount: totalTax,
                            grandTotal,
                            cashAmount: cashSale || undefined,
                            cardAmount: cardSale || undefined,
                            voucherAmount: voucherAmount || undefined,
                            tenderType: paymentMethod,
                            fbrInvoiceNumber: fbrInvoiceNumber || undefined,
                            fbrStatus: fbrInvoiceNumber ? 'SYNCED' : 'PENDING',
                            notes: notesParts.join(' | ') || undefined,
                            createdAt: createdAt || undefined,
                            items: {
                                create: lineItems.map((i) => ({
                                    itemId: i.itemId,
                                    quantity: i.quantity,
                                    unitPrice: i.unitPrice,
                                    discountPercent: i.discountPercent,
                                    discountAmount: i.discountAmount,
                                    taxPercent: i.taxPercent,
                                    taxAmount: i.taxAmount,
                                    lineTotal: i.lineTotal,
                                })),
                            },
                        },
                    });
                    this.logger.log(`Overrode existing order "${documentNumber}" (ID: ${salesOrderId})`);
                } else {
                    const conflictOrder = await prisma.salesOrder.findFirst({
                        where: {
                            OR: [
                                { orderNumber: orderNumber },
                                { notes: { equals: `Ref: ${documentNumber}` } },
                                { notes: { startsWith: `Ref: ${documentNumber} |` } },
                            ],
                        },
                        select: { id: true, orderNumber: true },
                    });

                    if (conflictOrder) {
                        salesOrderId = conflictOrder.id;
                        await prisma.salesOrderItem.deleteMany({ where: { salesOrderId } });
                        await prisma.salesOrder.update({
                            where: { id: salesOrderId },
                            data: {
                                paymentMethod,
                                paymentStatus,
                                status: 'completed',
                                subtotal,
                                discountAmount: totalDiscount,
                                taxAmount: totalTax,
                                grandTotal,
                                cashAmount: cashSale || undefined,
                                cardAmount: cardSale || undefined,
                                voucherAmount: voucherAmount || undefined,
                                tenderType: paymentMethod,
                                fbrInvoiceNumber: fbrInvoiceNumber || undefined,
                                fbrStatus: fbrInvoiceNumber ? 'SYNCED' : 'PENDING',
                                notes: notesParts.join(' | ') || undefined,
                                createdAt: createdAt || undefined,
                                items: {
                                    create: lineItems.map((i) => ({
                                        itemId: i.itemId,
                                        quantity: i.quantity,
                                        unitPrice: i.unitPrice,
                                        discountPercent: i.discountPercent,
                                        discountAmount: i.discountAmount,
                                        taxPercent: i.taxPercent,
                                        taxAmount: i.taxAmount,
                                        lineTotal: i.lineTotal,
                                    })),
                                },
                            },
                        });
                        this.logger.log(`Overrode existing order "${documentNumber}" via fallback resolution (ID: ${salesOrderId})`);
                    } else {
                        const salesOrder = await prisma.salesOrder.create({
                            data: {
                                orderNumber,
                                posId: firstRow.posId || terminalCtx.posId || undefined,
                                terminalId: terminalCtx.terminalId || undefined,
                                locationId: targetLocationId || undefined,
                                paymentMethod,
                                paymentStatus,
                                status: 'completed',
                                subtotal,
                                discountAmount: totalDiscount,
                                taxAmount: totalTax,
                                grandTotal,
                                cashAmount: cashSale || undefined,
                                cardAmount: cardSale || undefined,
                                voucherAmount: voucherAmount || undefined,
                                tenderType: paymentMethod,
                                fbrInvoiceNumber: fbrInvoiceNumber || undefined,
                                fbrStatus: fbrInvoiceNumber ? 'SYNCED' : 'PENDING',
                                notes: notesParts.join(' | ') || undefined,
                                createdAt: createdAt || undefined,
                                items: {
                                    create: lineItems.map((i) => ({
                                        itemId: i.itemId,
                                        quantity: i.quantity,
                                        unitPrice: i.unitPrice,
                                        discountPercent: i.discountPercent,
                                        discountAmount: i.discountAmount,
                                        taxPercent: i.taxPercent,
                                        taxAmount: i.taxAmount,
                                        lineTotal: i.lineTotal,
                                    })),
                                },
                            },
                        });
                        salesOrderId = salesOrder.id;
                    }
                }

                if (firstRow.fkExchangeVoucherNumber || voucherAmount > 0) {
                    await this.redeemVoucherIfAny(
                        firstRow.fkExchangeVoucherNumber,
                        voucherAmount,
                        salesOrderId,
                        orderNumber,
                        documentNumber,
                        targetLocationId,
                        prisma,
                    );
                }

                progress.successRecords += lineItems.length;

                if (hasItemError) {
                    const failedCount = rows.length - lineItems.length;
                    progress.failedRecords += failedCount;
                }
            } catch (error) {
                this.logger.error(
                    `Failed to process order "${documentNumber}": ${error.message}`,
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

    /**
     * Resolves location from CostCentre string or terminal context.
     * Uses exact match and normalized fuzzy matching against Location records.
     */
    private async resolveLocation(
        costCentre?: string,
        terminalLocationId?: string,
        prisma?: PrismaService,
    ): Promise<string | undefined> {
        if (!prisma) return terminalLocationId;

        if (costCentre) {
            const cleanCC = costCentre.trim().toLowerCase();
            const locations = await prisma.location.findMany({
                where: { isDeleted: false },
                select: { id: true, name: true, code: true, shortCode: true },
            });

            for (const loc of locations) {
                if (
                    loc.name.toLowerCase() === cleanCC ||
                    loc.code.toLowerCase() === cleanCC ||
                    (loc.shortCode && loc.shortCode.toLowerCase() === cleanCC)
                ) {
                    return loc.id;
                }
            }

            const normCC = cleanCC.replace(/[^a-z0-9]/g, '');
            for (const loc of locations) {
                const normName = loc.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (normName === normCC || normName.includes(normCC) || normCC.includes(normName)) {
                    return loc.id;
                }
            }
        }

        if (terminalLocationId) {
            const locExists = await prisma.location.findUnique({
                where: { id: terminalLocationId },
                select: { id: true },
            });
            if (locExists) return terminalLocationId;
        }

        const defaultLoc =
            (await prisma.location.findFirst({ where: { isDeleted: false, status: 'active' }, select: { id: true } })) ||
            (await prisma.location.findFirst({ select: { id: true } }));
        return defaultLoc?.id;
    }

    /**
     * Finds and marks redeemed any voucher matching FKExchangeVoucherNumber
     * or voucher reference during sales history upload.
     * Strictly restricted to exchange vouchers (EXC-) and the target store location.
     */
    private async redeemVoucherIfAny(
        fkVoucherRef: string | undefined,
        voucherAmount: number,
        salesOrderId: string,
        orderNumber: string,
        documentNumber: string,
        locationId: string | undefined,
        prisma: PrismaService,
    ): Promise<void> {
        if (!fkVoucherRef || !fkVoucherRef.trim()) return;

        const cleanRef = fkVoucherRef.trim();

        // Extract last numeric portion if reference is e.g. "25-26-61" or "25-26-0061"
        const parts = cleanRef.split('-').map((p) => p.trim()).filter(Boolean);
        const lastPart = parts[parts.length - 1] || cleanRef;
        const docNoStr = lastPart.replace(/^0+/, '') || lastPart;
        const paddedNum = docNoStr.padStart(4, '0');

        // Fetch target store location codes (e.g. SS-LG, SSLG)
        const locationCodes: string[] = [];
        if (locationId) {
            const loc = await prisma.location.findUnique({
                where: { id: locationId },
                select: { code: true, shortCode: true, name: true },
            });
            if (loc) {
                if (loc.shortCode) {
                    locationCodes.push(loc.shortCode.toUpperCase().replace(/[^A-Z0-9-]/g, ''));
                    locationCodes.push(loc.shortCode.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                }
                if (loc.code) {
                    locationCodes.push(loc.code.toUpperCase().replace(/[^A-Z0-9-]/g, ''));
                    locationCodes.push(loc.code.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                }
            }
        }

        // Strictly target exchange vouchers (EXC-) for the target location
        const candidateCodes = new Set<string>();
        candidateCodes.add(cleanRef.toUpperCase());

        for (const locCode of locationCodes) {
            candidateCodes.add(`EXC-${locCode}-${paddedNum}`);
            candidateCodes.add(`EXC-${locCode}-${docNoStr}`);
        }

        const orConditions: any[] = Array.from(candidateCodes).map((code) => ({
            code: { equals: code, mode: 'insensitive' },
        }));

        orConditions.push({ description: { contains: `Doc #${cleanRef}`, mode: 'insensitive' } });
        orConditions.push({ description: { contains: `Doc #${docNoStr}`, mode: 'insensitive' } });

        const voucher = await prisma.voucher.findFirst({
            where: {
                isDeleted: false,
                OR: orConditions,
            },
        });

        if (!voucher) {
            this.logger.warn(
                `No matching exchange voucher found for reference "${cleanRef}" (Tried codes: ${Array.from(candidateCodes).join(', ')}) (Order: ${orderNumber})`,
            );
            return;
        }

        try {
            await prisma.voucher.update({
                where: { id: voucher.id },
                data: {
                    isRedeemed: true,
                    isActive: false,
                },
            });

            // Remove any existing redemption record for this order to prevent unique constraint conflict on re-upload
            await prisma.voucherRedemption.deleteMany({
                where: { orderId: salesOrderId },
            });

            await prisma.voucherRedemption.create({
                data: {
                    voucherId: voucher.id,
                    orderId: salesOrderId,
                    amountUsed: voucherAmount || Number(voucher.faceValue),
                },
            });

            await prisma.voucherTransaction.create({
                data: {
                    voucherId: voucher.id,
                    orderId: salesOrderId,
                    locationId: locationId || undefined,
                    action: 'REDEEMED',
                    amountUsed: voucherAmount || Number(voucher.faceValue),
                    notes: `Redeemed during Sales History Bulk Upload for order ${orderNumber} (Ref: ${documentNumber})`,
                },
            });

            this.logger.log(`Redeemed voucher ${voucher.code} (ID: ${voucher.id}) for order ${orderNumber}`);
        } catch (e) {
            this.logger.error(`Failed to record redemption for voucher ${voucher.code}: ${e.message}`);
        }
    }
}
