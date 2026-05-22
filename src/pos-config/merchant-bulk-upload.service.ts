import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../database/prisma.service';
import { UploadEventsService } from '../finance/item/upload-events.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class MerchantBulkUploadService {
    private readonly logger = new Logger(MerchantBulkUploadService.name);

    constructor(
        @InjectQueue('merchant-upload') private uploadQueue: Queue,
        private prisma: PrismaService,
        private eventsService: UploadEventsService,
    ) { }

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

        // Persist file to disk so the import phase can recover it
        const uploadDir = path.join(process.cwd(), 'uploads', 'bulk', 'merchant');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        const ext = filename.split('.').pop();
        const filePath = path.join(uploadDir, `merchant-upload-${upload.id}.${ext}`);
        fs.writeFileSync(filePath, fileBuffer);

        const job = await this.uploadQueue.add({
            uploadId: upload.id,
            fileBuffer,
            filename,
            userId,
            tenantId: this.prisma.getTenantId() || '',
            tenantDbUrl: this.prisma.getTenantDbUrl() || '',
            mode: 'validate',
            uploadType: 'merchant',
        } as any, {
            removeOnComplete: false,
            removeOnFail: false,
        });

        const uniqueJobId = `${upload.id}:${job.id}`;
        await this.prisma.bulkUpload.update({
            where: { id: upload.id },
            data: { jobId: uniqueJobId },
        });

        this.logger.log(`Merchant validation initiated: ${upload.id} (Job: ${job.id}), saved to ${filePath}`);

        return { uploadId: upload.id, jobId: uniqueJobId };
    }

    async confirmUpload(uploadId: string, userId: string): Promise<{ uploadId: string; jobId: string }> {
        const upload = await this.prisma.bulkUpload.findUnique({ where: { id: uploadId } });

        if (!upload) throw new NotFoundException(`Upload ${uploadId} not found`);

        if (['processing', 'pending', 'completed'].includes(upload.status)) {
            return { uploadId: upload.id, jobId: upload.jobId };
        }

        if (upload.status !== 'validated') {
            throw new Error(`Upload must be in 'validated' status to confirm (current: ${upload.status})`);
        }

        this.eventsService.emit({
            uploadId,
            type: 'status',
            data: { status: 'pending', message: 'Import confirmation received...' },
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
            uploadType: 'merchant',
        } as any, {
            removeOnComplete: false,
            removeOnFail: false,
        });

        const uniqueJobId = `${upload.id}:${job.id}`;
        await this.prisma.bulkUpload.update({
            where: { id: upload.id },
            data: { jobId: uniqueJobId },
        });

        this.logger.log(`Merchant import confirmed: ${upload.id} (Job: ${job.id})`);

        return { uploadId, jobId: uniqueJobId };
    }

    async getUploadStatus(uploadId: string) {
        const upload = await this.prisma.bulkUpload.findUnique({ where: { id: uploadId } });
        if (!upload) throw new NotFoundException(`Upload ${uploadId} not found`);

        let jobProgress = 0;
        let jobState = 'unknown';
        try {
            const bullJobId = upload.jobId.includes(':')
                ? upload.jobId.split(':').slice(1).join(':')
                : upload.jobId;
            const job = await this.uploadQueue.getJob(bullJobId);
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

    async cancelUpload(uploadId: string): Promise<void> {
        const upload = await this.prisma.bulkUpload.findUnique({ where: { id: uploadId } });
        if (!upload) throw new NotFoundException(`Upload ${uploadId} not found`);

        try {
            const bullJobId = upload.jobId.includes(':')
                ? upload.jobId.split(':').slice(1).join(':')
                : upload.jobId;
            const job = await this.uploadQueue.getJob(bullJobId);
            if (job) await job.remove();
        } catch (error) {
            this.logger.warn(`Failed to remove job: ${error.message}`);
        }

        await this.prisma.bulkUpload.update({
            where: { id: uploadId },
            data: { status: 'cancelled', completedAt: new Date() },
        });

        this.logger.log(`Merchant upload cancelled: ${uploadId}`);
    }

    async getUploadHistory(userId: string, limit = 50) {
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

    generateErrorReport(errors: any[]): string {
        if (!errors || errors.length === 0) return 'No errors found';
        let csv = 'Row,Field,Reason,Value\n';
        errors.forEach((e) => {
            const row = e.row || 'N/A';
            const field = e.field || e.data?.field || 'N/A';
            const reason = (e.reason || '').replace(/"/g, '""');
            const value = e.value || e.data?.value || 'N/A';
            csv += `${row},${field},"${reason}",${value}\n`;
        });
        return csv;
    }
}
