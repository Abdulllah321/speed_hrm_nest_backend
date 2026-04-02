import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { UploadJobData } from '../../queue/processors/upload.processor';
import { UploadEventsService } from './upload-events.service';
import * as fs from 'fs';
import * as path from 'path';
import { CsvParserService } from '../../common/services/csv-parser.service';
import { ItemValidatorService } from '../../common/services/item-validator.service';

@Injectable()
export class ItemBulkUploadService {
    private readonly logger = new Logger(ItemBulkUploadService.name);

    constructor(
        @InjectQueue('item-upload') private uploadQueue: Queue,
        private prisma: PrismaService,
        private eventsService: UploadEventsService,
    ) { }

    /**
     * Initiate validation of bulk upload file
     */
    async initiateValidation(
        fileBuffer: Buffer,
        filename: string,
        userId: string,
    ): Promise<{ uploadId: string; jobId: string }> {
        // Use a UUID-based jobId upfront — avoids the two-step create+update
        // and eliminates the unique constraint race when Bull reuses integer IDs.
        const { v4: uuidv4 } = await import('uuid');
        const jobId = `validate-${uuidv4()}`;

        // Create upload record with the final jobId in one shot
        const upload = await this.prisma.bulkUpload.create({
            data: {
                jobId,
                filename,
                totalRecords: 0,
                uploadedBy: userId,
                status: 'validating',
            },
        });

        // Ensure uploads directory exists
        const uploadDir = path.join(process.cwd(), 'uploads', 'bulk');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const ext = filename.split('.').pop();
        const filePath = path.join(uploadDir, `upload-${upload.id}.${ext}`);
        fs.writeFileSync(filePath, fileBuffer);

        // Add validation job to queue — file is already on disk, no buffer needed
        const job = await this.uploadQueue.add({
            uploadId: upload.id,
            filename,
            userId,
            tenantId: this.prisma.getTenantId() || '',
            tenantDbUrl: this.prisma.getTenantDbUrl() || '',
            mode: 'validate',
        } as any, {
            jobId, // Pin Bull's job ID to our UUID — no update needed after
            removeOnComplete: false,
            removeOnFail: false,
        });

        this.logger.log(`Validation initiated: ${upload.id} (Job ID: ${jobId}), File saved to ${filePath}`);

        return {
            uploadId: upload.id,
            jobId,
        };
    }

    /**
     * Confirm and start the actual upload of valid records
     */
    async confirmUpload(uploadId: string, userId: string): Promise<{ uploadId: string; jobId: string }> {
        const upload = await this.prisma.bulkUpload.findUnique({
            where: { id: uploadId },
        });

        if (!upload) {
            throw new NotFoundException(`Upload ${uploadId} not found`);
        }

        if (upload.status === 'processing' || upload.status === 'pending' || upload.status === 'completed') {
            return {
                uploadId: upload.id,
                jobId: upload.jobId,
            };
        }

        if (upload.status !== 'validated') {
            throw new Error(`Upload must be in 'validated' status to be confirmed (current: ${upload.status})`);
        }

        // Notify client immediately
        this.eventsService.emit({
            uploadId,
            type: 'status',
            data: { status: 'pending', message: 'Import confirmation received...' }
        });

        // Update status to 'pending' (ready for actual processing)
        await this.prisma.bulkUpload.update({
            where: { id: uploadId },
            data: { status: 'pending', message: 'Confirming upload...' },
        });

        const { v4: uuidv4 } = await import('uuid');
        const importJobId = `import-${uuidv4()}`;

        // Add processing job to queue with a UUID-based job ID
        const job = await this.uploadQueue.add({
            uploadId: upload.id,
            filename: upload.filename,
            userId,
            tenantId: this.prisma.getTenantId() || '',
            tenantDbUrl: this.prisma.getTenantDbUrl() || '',
            mode: 'import',
        } as any, {
            jobId: importJobId,
            removeOnComplete: false,
            removeOnFail: false,
        });

        await this.prisma.bulkUpload.update({
            where: { id: upload.id },
            data: { jobId: importJobId },
        });

        this.logger.log(`Import confirmed: ${upload.id} (Job ID: ${importJobId})`);

        return {
            uploadId,
            jobId: importJobId,
        };
    }

    /**
     * Old initiateUpload - keeping it for compatibility or removing it if we refactor everywhere
     * Refactoring it to call initiateValidation by default.
     */
    async initiateUpload(
        fileBuffer: Buffer,
        filename: string,
        userId: string,
    ): Promise<{ uploadId: string; jobId: string }> {
        return this.initiateValidation(fileBuffer, filename, userId);
    }

    /**
     * Get upload status and progress
     */
    async getUploadStatus(uploadId: string) {
        const upload = await this.prisma.bulkUpload.findUnique({
            where: { id: uploadId },
        });

        if (!upload) {
            throw new NotFoundException(`Upload ${uploadId} not found`);
        }

        // Get job progress from Bull — with a timeout so a slow Redis never hangs the request
        let jobProgress = 0;
        let jobState = 'unknown';

        try {
            const jobPromise = this.uploadQueue.getJob(upload.jobId);
            const timeoutPromise = new Promise<null>((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 3000)
            );
            const job = await Promise.race([jobPromise, timeoutPromise]);
            if (job) {
                jobProgress = await job.progress();
                jobState = await job.getState();
            }
        } catch (error) {
            this.logger.warn(`Failed to get job status (${error.message}) — falling back to DB values`);
            // Fall through — DB values are still returned below
        }

        return {
            uploadId: upload.id,
            filename: upload.filename,
            status: upload.status,
            totalRecords: upload.totalRecords,
            processedRecords: upload.processedRecords,
            successRecords: upload.successRecords,
            failedRecords: upload.failedRecords,
            skippedRecords: upload.skippedRecords,
            progress: jobProgress,
            jobState,
            errors: upload.errors,
            message: upload.message,
            createdAt: upload.createdAt,
            completedAt: upload.completedAt,
        };
    }

    /**
     * Cancel upload
     */
    async cancelUpload(uploadId: string): Promise<void> {
        const upload = await this.prisma.bulkUpload.findUnique({
            where: { id: uploadId },
        });

        if (!upload) {
            throw new NotFoundException(`Upload ${uploadId} not found`);
        }

        // Remove job from queue
        try {
            const job = await this.uploadQueue.getJob(upload.jobId);
            if (job) {
                await job.remove();
            }
        } catch (error) {
            this.logger.warn(`Failed to remove job: ${error.message}`);
        }

        // Update status
        await this.prisma.bulkUpload.update({
            where: { id: uploadId },
            data: {
                status: 'cancelled',
                completedAt: new Date(),
            },
        });

        this.logger.log(`Upload cancelled: ${uploadId}`);
    }

    /**
     * Get upload history
     */
    async getUploadHistory(userId: string, limit: number = 50) {
        return this.prisma.bulkUpload.findMany({
            where: { uploadedBy: userId },
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: {
                id: true,
                filename: true,
                status: true,
                totalRecords: true,
                successRecords: true,
                failedRecords: true,
                skippedRecords: true,
                createdAt: true,
                completedAt: true,
            },
        });
    }

    /**
     * Check if error report JSONL is ready on disk.
     */
    async prepareErrorReport(uploadId: string): Promise<{ ready: boolean; totalErrors: number }> {
        const upload = await this.prisma.bulkUpload.findUnique({ where: { id: uploadId } });
        if (!upload) throw new NotFoundException(`Upload ${uploadId} not found`);
        const errorFilePath = path.join(process.cwd(), 'uploads', 'bulk', `errors-${uploadId}.jsonl`);
        return { ready: fs.existsSync(errorFilePath), totalErrors: upload.failedRecords ?? 0 };
    }

    /**
     * Regenerate JSONL error file in the background (for old uploads without it).
     * Caller should poll prepareErrorReport() until ready === true.
     */
    async regenerateErrorReport(uploadId: string): Promise<void> {
        const upload = await this.prisma.bulkUpload.findUnique({ where: { id: uploadId } });
        if (!upload) throw new NotFoundException(`Upload ${uploadId} not found`);

        const ext = upload.filename.split('.').pop();
        const uploadFilePath = path.join(process.cwd(), 'uploads', 'bulk', `upload-${uploadId}.${ext}`);
        const errorFilePath = path.join(process.cwd(), 'uploads', 'bulk', `errors-${uploadId}.jsonl`);
        const tmpPath = errorFilePath + '.tmp';

        if (fs.existsSync(errorFilePath)) return;
        if (!fs.existsSync(uploadFilePath)) throw new Error('Original upload file not found on disk.');

        // Emit initial SSE so frontend knows generation started
        this.eventsService.emit({
            uploadId,
            type: 'status',
            data: { message: 'Generating error report...', reportGenerating: true, reportReady: false }
        });

        setImmediate(async () => {
            const writeStream = fs.createWriteStream(tmpPath, { flags: 'w' });
            let errorsWritten = 0;
            let lastEmit = Date.now();

            const writeError = (e: any): Promise<void> => {
                errorsWritten++;
                const line = JSON.stringify(e) + '\n';
                const ok = writeStream.write(line);
                if (!ok) return new Promise(r => writeStream.once('drain', r));
                return Promise.resolve();
            };

            try {
                const csvParser = new CsvParserService();
                const validator = new ItemValidatorService();
                const itemIdSet = new Set<string>();
                let batch: any[] = [];

                await csvParser.parseFileFromPath(uploadFilePath, upload.filename, async (record) => {
                    const itemId = record.data.itemId ? String(record.data.itemId).trim() : undefined;
                    const barCode = record.data.barCode ? String(record.data.barCode).trim() : undefined;

                    if (record.data.itemId) {
                        const norm = String(record.data.itemId).trim().toLowerCase();
                        if (itemIdSet.has(norm)) {
                            await writeError({ row: record.row, field: 'ItemID', value: record.data.itemId, reason: 'Duplicate ItemID found within file.', itemId, barCode });
                        } else {
                            itemIdSet.add(norm);
                        }
                    }
                    batch.push(record);

                    if (batch.length >= 1000) {
                        for (const e of validator.validateRecords(batch)) await writeError(e);
                        batch = [];
                        await new Promise(r => setImmediate(r));

                        // Emit progress every 500ms via SSE
                        const now = Date.now();
                        if (now - lastEmit > 500) {
                            lastEmit = now;
                            this.eventsService.emit({
                                uploadId,
                                type: 'status',
                                data: {
                                    message: `Generating error report: ${errorsWritten.toLocaleString()} errors written...`,
                                    reportGenerating: true,
                                    reportReady: false,
                                    reportErrorsWritten: errorsWritten,
                                }
                            });
                        }
                    }
                });

                if (batch.length > 0) {
                    for (const e of validator.validateRecords(batch)) await writeError(e);
                }

                await new Promise<void>((res, rej) => writeStream.end((err: any) => err ? rej(err) : res()));
                fs.renameSync(tmpPath, errorFilePath);

                this.logger.log(`Error report regenerated for ${uploadId}: ${errorsWritten} errors`);
                this.eventsService.emit({
                    uploadId,
                    type: 'status',
                    data: {
                        message: `Error report ready: ${errorsWritten.toLocaleString()} errors`,
                        reportGenerating: false,
                        reportReady: true,
                        reportErrorsWritten: errorsWritten,
                    }
                });
            } catch (err: any) {
                this.logger.error(`Failed to regenerate error report for ${uploadId}: ${err.message}`);
                writeStream.destroy();
                try { fs.unlinkSync(tmpPath); } catch { }
                this.eventsService.emit({
                    uploadId,
                    type: 'status',
                    data: { message: `Error report generation failed: ${err.message}`, reportGenerating: false, reportReady: false }
                });
            }
        });
    }

    /**
     * Stream error report as CSV directly from the on-disk JSONL file.
     * Handles 70k+ error rows without loading everything into memory or timing out.
     */
    async streamErrorReport(uploadId: string, res: any): Promise<void> {
        const upload = await this.prisma.bulkUpload.findUnique({ where: { id: uploadId } });
        if (!upload) {
            res.code(404).send({ status: false, message: 'Upload not found' });
            return;
        }

        const errorFilePath = path.join(process.cwd(), 'uploads', 'bulk', `errors-${uploadId}.jsonl`);

        // Send headers directly on the raw socket — Fastify's reply.header() buffers
        // headers until reply.send() is called, but we're streaming via res.raw.write()
        // which bypasses that buffer. Writing headers on res.raw ensures they go out first.
        const raw = res.raw;
        raw.writeHead(200, {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="error-report-${uploadId}.csv"`,
            'Transfer-Encoding': 'chunked',
            'Cache-Control': 'no-cache',
        });
        raw.write('Row,ItemID,BarCode,Field,Reason\n');

        const writeLine = (e: any) => {
            const row = e.row ?? 'N/A';
            const itemId = String(e.itemId ?? '').replace(/"/g, '""');
            const barCode = String(e.barCode ?? '').replace(/"/g, '""');
            const field = e.field ?? e.data?.field ?? 'N/A';
            const reason = String(e.reason ?? '').replace(/"/g, '""');
            raw.write(`${row},"${itemId}","${barCode}",${field},"${reason}"\n`);
        };

        // No JSONL on disk — fall back to DB preview errors (capped at 100)
        if (!fs.existsSync(errorFilePath)) {
            const errors = (Array.isArray(upload.errors) ? upload.errors : []) as any[];
            for (const e of errors) writeLine(e);
            raw.end();
            return;
        }

        // Stream JSONL line by line — O(1) memory regardless of file size
        const { createInterface } = await import('readline');
        const rl = createInterface({ input: fs.createReadStream(errorFilePath), crlfDelay: Infinity });
        rl.on('line', (line) => { if (line.trim()) { try { writeLine(JSON.parse(line)); } catch { } } });
        rl.on('close', () => raw.end());
        rl.on('error', () => raw.end());
    }

    /**
     * Generate error report CSV (legacy — kept for compatibility)
     */
    generateErrorReport(errors: any[]): string {
        if (!errors || errors.length === 0) {
            return 'No errors found';
        }

        // CSV Header
        let csv = 'Row,Reason,Field,Value\n';

        // CSV Rows
        errors.forEach((error) => {
            const row = error.row || 'N/A';
            const reason = (error.reason || '').replace(/"/g, '""'); // Escape quotes
            const field = error.data?.field || 'N/A';
            const value = error.data?.value || 'N/A';

            csv += `${row},"${reason}",${field},${value}\n`;
        });

        return csv;
    }
}
