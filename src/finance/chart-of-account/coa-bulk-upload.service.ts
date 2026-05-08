import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadEventsService } from '../item/upload-events.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class CoaBulkUploadService {
    private readonly logger = new Logger(CoaBulkUploadService.name);

    constructor(
        @InjectQueue('coa-upload') private uploadQueue: Queue,
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
        const tempJobId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        const upload = await this.prisma.bulkUpload.create({
            data: {
                jobId: tempJobId,
                filename,
                totalRecords: 0,
                uploadedBy: userId,
                status: 'validating',
            },
        });

        const uploadDir = path.join(process.cwd(), 'uploads', 'bulk', 'coa');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const ext = filename.split('.').pop();
        const filePath = path.join(uploadDir, `coa-upload-${upload.id}.${ext}`);
        fs.writeFileSync(filePath, fileBuffer);

        const job = await this.uploadQueue.add({
            uploadId: upload.id,
            fileBuffer,
            filename,
            userId,
            tenantId: this.prisma.getTenantId() || '',
            tenantDbUrl: this.prisma.getTenantDbUrl() || '',
            mode: 'validate',
            uploadType: 'coa',
        } as any, {
            removeOnComplete: false,
            removeOnFail: false,
        });

        await this.prisma.bulkUpload.update({
            where: { id: upload.id },
            data: { jobId: String(job.id) },
        });

        this.logger.log(`COA validation initiated: ${upload.id} (Job ID: ${job.id}), File saved to ${filePath}`);

        return {
            uploadId: upload.id,
            jobId: String(job.id),
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

        this.eventsService.emit({
            uploadId,
            type: 'status',
            data: { status: 'pending', message: 'Import confirmation received...' }
        });

        await this.prisma.bulkUpload.update({
            where: { id: uploadId },
            data: { status: 'pending', message: 'Confirming upload...' },
        });

        const job = await this.uploadQueue.add({
            uploadId: upload.id,
            filename: upload.filename,
            userId,
            tenantId: this.prisma.getTenantId() || '',
            tenantDbUrl: this.prisma.getTenantDbUrl() || '',
            mode: 'import',
            uploadType: 'coa',
        } as any, {
            removeOnComplete: false,
            removeOnFail: false,
        });

        await this.prisma.bulkUpload.update({
            where: { id: upload.id },
            data: { jobId: String(job.id) },
        });

        this.logger.log(`COA import confirmed: ${upload.id} (Job ID: ${job.id})`);

        return {
            uploadId,
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

        try {
            const job = await this.uploadQueue.getJob(upload.jobId);
            if (job) {
                await job.remove();
            }
        } catch (error) {
            this.logger.warn(`Failed to remove job: ${error.message}`);
        }

        await this.prisma.bulkUpload.update({
            where: { id: uploadId },
            data: {
                status: 'cancelled',
                completedAt: new Date(),
            },
        });

        this.logger.log(`COA upload cancelled: ${uploadId}`);
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

        let csv = 'Row,Reason,Field,Value\n';

        errors.forEach((error) => {
            const row = error.row || 'N/A';
            const reason = (error.reason || '').replace(/"/g, '""');
            const field = error.data?.field || 'N/A';
            const value = error.data?.value || 'N/A';

            csv += `${row},"${reason}",${field},${value}\n`;
        });

        return csv;
    }
}
