import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { UploadJobData } from '../../queue/processors/upload.processor';

@Injectable()
export class ItemBulkUploadService {
    private readonly logger = new Logger(ItemBulkUploadService.name);

    constructor(
        @InjectQueue('item-upload') private uploadQueue: Queue,
        private prisma: PrismaService,
    ) { }

    /**
     * Initiate bulk upload
     */
    async initiateUpload(
        fileBuffer: Buffer,
        filename: string,
        userId: string,
    ): Promise<{ uploadId: string; jobId: string }> {
        // Create upload record
        const upload = await this.prisma.bulkUpload.create({
            data: {
                jobId: '', // Will update after job creation
                filename,
                totalRecords: 0, // Will update after parsing
                uploadedBy: userId,
                status: 'pending',
            },
        });

        // Add job to queue
        const job = await this.uploadQueue.add({
            uploadId: upload.id,
            fileBuffer,
            filename,
            userId,
            tenantId: this.prisma.getTenantId() || '',
            tenantDbUrl: this.prisma.getTenantDbUrl() || '',
        } as UploadJobData, {
            removeOnComplete: false,
            removeOnFail: false,
        });

        // Update upload with job ID
        await this.prisma.bulkUpload.update({
            where: { id: upload.id },
            data: { jobId: String(job.id) },
        });

        this.logger.log(`Upload initiated: ${upload.id} (Job ID: ${job.id})`);

        return {
            uploadId: upload.id,
            jobId: String(job.id),
        };
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

        // Get job progress from Bull
        let jobProgress = 0;
        let jobState = 'unknown';

        try {
            const job = await this.uploadQueue.getJob(upload.jobId);
            if (job) {
                jobProgress = await job.progress();
                jobState = await job.getState();
            }
        } catch (error) {
            this.logger.warn(`Failed to get job status: ${error.message}`);
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
