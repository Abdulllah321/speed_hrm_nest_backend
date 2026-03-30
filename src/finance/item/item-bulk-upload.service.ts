import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { UploadJobData } from '../../queue/processors/upload.processor';
import { UploadEventsService } from './upload-events.service';
import * as fs from 'fs';
import * as path from 'path';

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
     * Generate error report CSV
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
