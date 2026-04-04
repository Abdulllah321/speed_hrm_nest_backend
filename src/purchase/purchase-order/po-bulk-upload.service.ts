import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class PoBulkUploadService {
    private readonly logger = new Logger(PoBulkUploadService.name);

    constructor(
        @InjectQueue('po-upload') private uploadQueue: Queue,
        private prisma: PrismaService,
        private eventsService: UploadEventsService,
    ) { }

    async initiateValidation(fileBuffer: Buffer, filename: string, userId: string): Promise<{ uploadId: string; jobId: string }> {
        const tempJobId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const upload = await this.prisma.bulkUpload.create({
            data: { jobId: tempJobId, filename, totalRecords: 0, uploadedBy: userId, status: 'validating' },
        });

        const uploadDir = path.join(process.cwd(), 'uploads', 'bulk', 'po');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

        const ext = filename.split('.').pop();
        fs.writeFileSync(path.join(uploadDir, `po-upload-${upload.id}.${ext}`), fileBuffer);

        const job = await this.uploadQueue.add({
            uploadId: upload.id, fileBuffer, filename, userId,
            tenantId: this.prisma.getTenantId() || '',
            tenantDbUrl: this.prisma.getTenantDbUrl() || '',
            mode: 'validate',
        } as any, { removeOnComplete: false, removeOnFail: false });

        await this.prisma.bulkUpload.update({ where: { id: upload.id }, data: { jobId: String(job.id) } });
        return { uploadId: upload.id, jobId: String(job.id) };
    }

    async confirmUpload(uploadId: string, userId: string): Promise<{ uploadId: string; jobId: string }> {
        const upload = await this.prisma.bulkUpload.findUnique({ where: { id: uploadId } });
        if (!upload) throw new NotFoundException(`Upload ${uploadId} not found`);
        if (['processing', 'pending', 'completed'].includes(upload.status)) return { uploadId: upload.id, jobId: upload.jobId };
        if (upload.status !== 'validated') throw new Error(`Upload must be 'validated' to confirm (current: ${upload.status})`);

        this.eventsService.emit({ uploadId, type: 'status', data: { status: 'pending', message: 'Import confirmation received...' } });
        await this.prisma.bulkUpload.update({ where: { id: uploadId }, data: { status: 'pending', message: 'Confirming upload...' } });

        const job = await this.uploadQueue.add({
            uploadId: upload.id, filename: upload.filename, userId,
            tenantId: this.prisma.getTenantId() || '',
            tenantDbUrl: this.prisma.getTenantDbUrl() || '',
            mode: 'import',
        } as any, { removeOnComplete: false, removeOnFail: false });

        await this.prisma.bulkUpload.update({ where: { id: upload.id }, data: { jobId: String(job.id) } });
        return { uploadId, jobId: String(job.id) };
    }

    async getUploadStatus(uploadId: string) {
        const upload = await this.prisma.bulkUpload.findUnique({ where: { id: uploadId } });
        if (!upload) throw new NotFoundException(`Upload ${uploadId} not found`);

        let jobProgress = 0, jobState = 'unknown';
        try {
            const job = await this.uploadQueue.getJob(upload.jobId);
            if (job) { jobProgress = await job.progress(); jobState = await job.getState(); }
        } catch (e) { this.logger.warn(`Failed to get job status: ${e.message}`); }

        return {
            uploadId: upload.id, filename: upload.filename, status: upload.status,
            totalRecords: upload.totalRecords, processedRecords: upload.processedRecords,
            successRecords: upload.successRecords, failedRecords: upload.failedRecords,
            skippedRecords: upload.skippedRecords, progress: jobProgress, jobState,
            errors: upload.errors, message: upload.message,
            createdAt: upload.createdAt, completedAt: upload.completedAt,
        };
    }

    async cancelUpload(uploadId: string): Promise<void> {
        const upload = await this.prisma.bulkUpload.findUnique({ where: { id: uploadId } });
        if (!upload) throw new NotFoundException(`Upload ${uploadId} not found`);
        try { const job = await this.uploadQueue.getJob(upload.jobId); if (job) await job.remove(); } catch (e) { }
        await this.prisma.bulkUpload.update({ where: { id: uploadId }, data: { status: 'cancelled', completedAt: new Date() } });
    }

    generateErrorReport(errors: any[]): string {
        if (!errors?.length) return 'No errors found';
        let csv = 'Row,Field,Reason,Value\n';
        errors.forEach(e => {
            csv += `${e.row || 'N/A'},${e.field || e.data?.field || 'N/A'},"${(e.reason || '').replace(/"/g, '""')}",${e.value || e.data?.value || 'N/A'}\n`;
        });
        return csv;
    }
}
