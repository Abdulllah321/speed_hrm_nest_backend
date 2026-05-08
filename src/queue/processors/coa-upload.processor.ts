import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { CoaCsvParserService, CoaParsedRecord } from '../../common/services/coa-csv-parser.service';
import { CoaValidatorService } from '../../common/services/coa-validator.service';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { AccountingService } from '../../finance/accounting/accounting.service';
import * as fs from 'fs';
import * as path from 'path';

export interface CoaUploadJobData {
    uploadId: string;
    fileBuffer: Buffer;
    filename: string;
    userId: string;
    tenantId: string;
    tenantDbUrl: string;
    uploadType: 'coa';
}

export interface CoaUploadProgress {
    totalRecords: number;
    processedRecords: number;
    successRecords: number;
    failedRecords: number;
    skippedRecords: number;
    recsPerSec?: number;
    memoryUsageMB?: number;
    errors: Array<{
        row: number;
        reason: string;
        data: any;
    }>;
}

@Processor('coa-upload')
export class CoaUploadProcessor {
    private readonly logger = new Logger(CoaUploadProcessor.name);

    constructor(
        private readonly csvParser: CoaCsvParserService,
        private readonly validator: CoaValidatorService,
        private readonly eventsService: UploadEventsService,
        private readonly notificationsService: NotificationsService,
        private readonly accountingService: AccountingService,
    ) { }

    @Process()
    async handleUpload(job: Job<any>): Promise<void> {
        let { uploadId, fileBuffer, filename, userId, tenantId, tenantDbUrl, mode } = job.data;
        mode = mode || 'import';

        this.logger.log(`[Job ${job.id}] COA ${mode.toUpperCase()} phase started for ${filename} (Upload ID: ${uploadId})`);

        // Reconstruct Buffer if provided (validation phase)
        if (fileBuffer && (fileBuffer as any).type === 'Buffer' && Array.isArray((fileBuffer as any).data)) {
            fileBuffer = Buffer.from((fileBuffer as any).data);
        }

        // Recover from disk if missing (import phase)
        if (!fileBuffer) {
            const ext = filename.split('.').pop();
            const filePath = path.join(process.cwd(), 'uploads', 'bulk', 'coa', `coa-upload-${uploadId}.${ext}`);
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
                data: { status: mode === 'validate' ? 'validating' : 'processing', message: mode === 'validate' ? 'Starting COA Validation...' : 'Starting COA Import...' }
            });

            const progress: CoaUploadProgress = {
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
            const codeSet = new Set<string>();

            if (mode === 'import') {
                this.logger.log(`[Job ${job.id}] Starting COA Import for ${uploadId} — collecting all records first`);
                
                const uploadRecord = await prisma.bulkUpload.findUnique({
                    where: { id: uploadId },
                    select: { errors: true, totalRecords: true }
                });
                
                const allValidationErrors = (Array.isArray(uploadRecord?.errors) ? uploadRecord.errors : []) as any[];
                const invalidRows = new Set(allValidationErrors.map(e => e.row));

                progress.totalRecords = uploadRecord?.totalRecords || 0;
                progress.failedRecords = invalidRows.size;
                progress.errors = allValidationErrors.map(e => ({
                    row: e.row,
                    reason: `${e.field}: ${e.reason}`,
                    data: { field: e.field, value: e.value },
                }));

                // ── Pass 1: collect every valid record into memory ────────────
                const allRecords: CoaParsedRecord[] = [];
                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record) => {
                    totalRecordsCount++;
                    if (!invalidRows.has(record.row)) {
                        allRecords.push(record);
                    }
                });

                this.logger.log(`[Job ${job.id}] Collected ${allRecords.length} valid records — starting hierarchy import`);

                await job.progress(5);
                this.eventsService.emit({
                    uploadId,
                    type: 'progress',
                    data: { progress: 5, status: 'processing', message: `Collected ${allRecords.length} records — importing in hierarchy order...` }
                });

                // ── Pass 2: process all records in one sorted call ────────────
                await this.processBatch(allRecords, progress, uploadId, prisma);

                await job.progress(100);
            } else {
                // Stage 1: Validation Mode
                this.eventsService.emit({ uploadId, type: 'status', data: { message: 'Streaming COA validation scan...' } });

                let validationBatch: CoaParsedRecord[] = [];
                const allValidationErrors: any[] = [];

                await this.csvParser.parseFileStreaming(fileBuffer, filename, async (record) => {
                    totalRecordsCount++;
                    
                    if (record.data.code) {
                        const normalized = String(record.data.code).trim().toLowerCase();
                        // Only check structural COA codes (1, 2, 4, or 8 digit numeric) for duplicates.
                        // Sub-ledger party codes (6-digit numeric like 120150, 310047) and
                        // alphanumeric tag codes (DIR001, C00001) legitimately repeat across
                        // multiple parent accounts and must never be flagged as duplicates.
                        const isStructuralCode = /^\d+$/.test(normalized) && [1, 2, 4, 8].includes(normalized.length);
                        if (isStructuralCode) {
                            if (codeSet.has(normalized)) {
                                allValidationErrors.push({
                                    row: record.row,
                                    field: 'code',
                                    value: record.data.code,
                                    reason: `Duplicate structural account code "${record.data.code}" found within file.`
                                });
                            } else {
                                codeSet.add(normalized);
                            }
                        }
                    }

                    validationBatch.push(record);

                    if (validationBatch.length >= 500) {
                        const batchErrors = await this.validator.validateRecords(validationBatch);
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
                                data: { progress: 10, status: 'validating', message: `Validating COA: ${totalRecordsCount} rows scanned...` }
                            });
                        }
                    }
                });

                if (validationBatch.length > 0) {
                    const batchErrors = await this.validator.validateRecords(validationBatch);
                    allValidationErrors.push(...batchErrors);
                    successRecordsCount += (validationBatch.length - batchErrors.length);
                }
                
                codeSet.clear();

                await prisma.bulkUpload.update({
                    where: { id: uploadId },
                    data: {
                        status: 'validated',
                        totalRecords: totalRecordsCount,
                        failedRecords: allValidationErrors.length,
                        successRecords: successRecordsCount,
                        errors: allValidationErrors as any,
                        message: `COA validation complete: ${successRecordsCount} valid, ${allValidationErrors.length} invalid.`,
                        completedAt: new Date(),
                    },
                });

                await this.notificationsService.create({
                    userId,
                    title: 'Chart of Accounts Validation Completed',
                    message: `COA bulk validation finished: ${successRecordsCount} valid rows, ${allValidationErrors.length} invalid.`,
                    category: 'system',
                    priority: 'normal',
                    channels: ['inApp']
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
                        progress: 100
                    }
                });
                return;
            }

            await prisma.bulkUpload.update({
                where: { id: uploadId },
                data: {
                    status: 'completed',
                    message: `COA import completed successfully: ${progress.successRecords} accounts added.`,
                    completedAt: new Date(),
                },
            });

            await this.notificationsService.create({
                userId,
                title: 'Chart of Accounts Import Completed',
                message: `COA bulk import finished: ${progress.successRecords} added, ${progress.failedRecords} failed.`,
                category: 'system',
                priority: 'high',
                channels: ['inApp']
            });

            this.eventsService.emit({
                uploadId,
                type: 'completed',
                data: {
                    status: 'completed',
                    successRecords: progress.successRecords,
                    failedRecords: progress.failedRecords,
                    progress: 100
                }
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
                    title: 'COA Bulk Job Failed',
                    message: `The requested COA ${mode} job failed unexpectedly: ${error.message}`,
                    category: 'system',
                    priority: 'urgent',
                    channels: ['inApp']
                });

                this.eventsService.emit({ uploadId, type: 'failed', data: { message: error.message } });
            } catch (e) {
                this.logger.error(`Failed to update failure status in DB: ${e.message}`);
            }
        } finally {
            await prisma.$disconnect();
        }
    }

    /**
     * Process ALL COA records in strict hierarchy order:
     *   1-digit (Main) → 2-digit (Control) → 4-digit (Sub-control) →
     *   8-digit (Leaf) → sub-ledger entries (any other format)
     *
     * This guarantees every parent exists in the DB before its children
     * are inserted, regardless of the order rows appear in the file.
     */
    private async processBatch(
        batch: CoaParsedRecord[],
        progress: CoaUploadProgress,
        uploadId: string,
        prisma: PrismaService,
    ): Promise<void> {
        // ── Tier ordering ────────────────────────────────────────────────────
        const tierOf = (code: string): number => {
            if (/^\d+$/.test(code)) {
                if (code.length === 1) return 0; // Main
                if (code.length === 2) return 1; // Control
                if (code.length === 4) return 2; // Sub-control
                if (code.length === 8) return 3; // Leaf
            }
            return 4; // Sub-ledger / party entry
        };

        const sorted = [...batch].sort((a, b) => tierOf(a.data.code) - tierOf(b.data.code));

        // ── Pre-load all codes that already exist in DB ──────────────────────
        const allCodes = [
            ...new Set([
                ...sorted.map(r => r.data.code).filter((c): c is string => Boolean(c)),
                ...sorted.map(r => r.data.parentCode).filter((c): c is string => Boolean(c)),
            ]),
        ];

        const existingAccounts = await prisma.chartOfAccount.findMany({
            where: { code: { in: allCodes } },
            select: { id: true, code: true },
        });
        // codeToIdMap is the single source of truth for parent resolution.
        // It is updated in-memory as new accounts are created so that
        // children created later in the same batch can find their parents.
        const codeToIdMap = new Map(existingAccounts.map(a => [a.code, a.id]));

        // Track ALL codes that failed (structural or not) so descendants cascade-skip
        const failedCodes = new Set<string>();

        /**
         * Returns true if any ancestor of `code` is in the failed set.
         */
        const hasFailedAncestor = (code: string, parentCode: string | undefined): boolean => {
            if (parentCode && failedCodes.has(parentCode)) return true;
            if (/^\d+$/.test(code)) {
                if (code.length >= 8 && failedCodes.has(code.substring(0, 4))) return true;
                if (code.length >= 4 && failedCodes.has(code.substring(0, 2))) return true;
                if (code.length >= 2 && failedCodes.has(code.substring(0, 1))) return true;
            }
            return false;
        };

        /**
         * Determine account type from first digit of code.
         */
        const typeOf = (code: string): string => {
            switch (code.charAt(0)) {
                case '1': return 'EQUITY';
                case '2': return 'LIABILITY';
                case '3': return 'ASSET';
                case '4': case '5': case '6': case '7': return 'INCOME';
                case '8': case '9': return 'EXPENSE';
                default: return 'ASSET';
            }
        };

        /**
         * Ensure a structural parent exists in DB and codeToIdMap.
         * If it's missing from the file, create it automatically as a group account
         * so the hierarchy is never broken by a missing intermediate node.
         */
        const ensureParent = async (parentCode: string): Promise<string | undefined> => {
            if (codeToIdMap.has(parentCode)) return codeToIdMap.get(parentCode);
            if (failedCodes.has(parentCode)) return undefined;

            // Recursively ensure grandparent first
            let grandParentId: string | undefined;
            if (parentCode.length > 1) {
                const grandParentCode =
                    parentCode.length === 2 ? parentCode.substring(0, 1) :
                    parentCode.length === 4 ? parentCode.substring(0, 2) :
                    parentCode.length === 8 ? parentCode.substring(0, 4) : undefined;

                if (grandParentCode) {
                    grandParentId = await ensureParent(grandParentCode);
                    if (!grandParentId) {
                        failedCodes.add(parentCode);
                        return undefined;
                    }
                }
            }

            try {
                this.logger.warn(`Auto-creating missing structural parent "${parentCode}"`);
                const created = await prisma.chartOfAccount.create({
                    data: {
                        code: parentCode,
                        name: parentCode, // placeholder name
                        type: typeOf(parentCode) as any,
                        isGroup: true,
                        parentId: grandParentId,
                        balance: 0,
                        isActive: true,
                    },
                });
                codeToIdMap.set(parentCode, created.id);
                return created.id;
            } catch (err) {
                this.logger.error(`Failed to auto-create parent "${parentCode}": ${err.message}`);
                failedCodes.add(parentCode);
                return undefined;
            }
        };

        for (const record of sorted) {
            try {
                const { code, name, type, isGroup, parentCode, isTagEntry, debit, credit } = record.data;

                // ── Skip if any ancestor failed ──────────────────────────────
                if (hasFailedAncestor(code, parentCode)) {
                    progress.skippedRecords++;
                    progress.processedRecords++;
                    continue;
                }

                // ── Structural duplicate guard ───────────────────────────────
                const isStructural = /^\d+$/.test(code) && [1, 2, 4, 8].includes(code.length);
                if (isStructural && codeToIdMap.has(code)) {
                    progress.skippedRecords++;
                    progress.processedRecords++;
                    continue;
                }

                // ── Resolve parent (auto-create if missing) ──────────────────
                let parentId: string | undefined;
                if (parentCode) {
                    parentId = codeToIdMap.get(parentCode);
                    if (!parentId) {
                        // Try to auto-create the missing structural parent chain
                        parentId = await ensureParent(parentCode);
                    }
                    if (!parentId) {
                        this.logger.error(`Parent "${parentCode}" could not be resolved for "${code}" (row ${record.row}).`);
                        progress.failedRecords++;
                        progress.errors.push({
                            row: record.row,
                            reason: `Parent account "${parentCode}" not found and could not be auto-created`,
                            data: { field: 'parentCode', value: parentCode },
                        });
                        failedCodes.add(code);
                        progress.processedRecords++;
                        continue;
                    }
                }

                // ── Create account ───────────────────────────────────────────
                const created = await prisma.chartOfAccount.create({
                    data: { code, name, type, isGroup, parentId, balance: 0, isActive: true },
                });

                codeToIdMap.set(code, created.id);

                // ── Opening balance ──────────────────────────────────────────
                if (!isGroup && (debit || credit)) {
                    await this.accountingService.postLines(
                        [{ accountId: created.id, debit: debit || 0, credit: credit || 0 }],
                        {
                            sourceType: 'OPENING_BALANCE',
                            sourceId: created.id,
                            sourceRef: `Opening Balance - ${code}`,
                            description: `Opening Balance for ${name}`,
                            transactionDate: new Date(),
                        },
                        prisma,
                    );
                }

                progress.successRecords++;
            } catch (error) {
                this.logger.error(`Failed to create account at row ${record.row}: ${error.message}`);
                progress.failedRecords++;
                progress.errors.push({
                    row: record.row,
                    reason: error.message,
                    data: { field: 'unknown', value: record.data.code },
                });
                failedCodes.add(record.data.code);
            }
            progress.processedRecords++;
        }
    }
}
