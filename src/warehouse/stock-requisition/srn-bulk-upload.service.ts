import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

@Injectable()
export class SrnBulkUploadService {
    private readonly logger = new Logger(SrnBulkUploadService.name);

    constructor(
        @InjectQueue('srn-upload') private uploadQueue: Queue,
        private prisma: PrismaService,
        private eventsService: UploadEventsService,
    ) { }

    async initiateValidation(
        fileBuffer: Buffer,
        filename: string,
        userId: string,
        metadata?: { fromWarehouseId?: string; toLocationId?: string; brandId?: string; documentType?: string; financialYear?: string; remarks?: string; notes?: string }
    ): Promise<{ uploadId: string; jobId: string }> {
        const uploadDir = path.join(process.cwd(), 'uploads', 'bulk', 'srn');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

        const uploadId = randomUUID();

        const upload = await this.prisma.bulkUpload.create({
            data: { id: uploadId, jobId: uploadId, filename, totalRecords: 0, uploadedBy: userId, status: 'validating' },
        });

        const ext = filename.split('.').pop();
        fs.writeFileSync(path.join(uploadDir, `srn-upload-${upload.id}.${ext}`), fileBuffer);

        await this.uploadQueue.add({
            uploadId: upload.id, fileBuffer, filename, userId,
            tenantId: this.prisma.getTenantId() || '',
            tenantDbUrl: this.prisma.getTenantDbUrl() || '',
            mode: 'validate',
            metadata,
        } as any, { jobId: upload.id, removeOnComplete: false, removeOnFail: false });

        return { uploadId: upload.id, jobId: upload.id };
    }

    async confirmUpload(
        uploadId: string,
        userId: string,
        metadata?: { fromWarehouseId?: string; toLocationId?: string; brandId?: string; documentType?: string; financialYear?: string; remarks?: string; notes?: string }
    ): Promise<{ uploadId: string; jobId: string }> {
        const upload = await this.prisma.bulkUpload.findUnique({ where: { id: uploadId } });
        if (!upload) throw new NotFoundException(`Upload ${uploadId} not found`);
        if (['processing', 'pending', 'completed'].includes(upload.status)) return { uploadId: upload.id, jobId: upload.jobId };
        if (upload.status !== 'validated') throw new Error(`Upload must be 'validated' to confirm (current: ${upload.status})`);

        this.eventsService.emit({ uploadId, type: 'status', data: { status: 'pending', message: 'Import confirmation received...' } });
        await this.prisma.bulkUpload.update({ where: { id: uploadId }, data: { status: 'pending', message: 'Confirming upload...' } });

        const importJobId = `import-${upload.id}`;
        await this.prisma.bulkUpload.update({ where: { id: upload.id }, data: { jobId: importJobId } });

        await this.uploadQueue.add({
            uploadId: upload.id, filename: upload.filename, userId,
            tenantId: this.prisma.getTenantId() || '',
            tenantDbUrl: this.prisma.getTenantDbUrl() || '',
            mode: 'import',
            metadata,
        } as any, { jobId: importJobId, removeOnComplete: false, removeOnFail: false });

        return { uploadId, jobId: importJobId };
    }

    async getUploadStatus(uploadId: string) {
        const upload = await this.prisma.bulkUpload.findUnique({ where: { id: uploadId } });
        if (!upload) throw new NotFoundException(`Upload ${uploadId} not found`);

        let jobProgress = 0, jobState = 'unknown';
        try {
            const bullJobId = upload.jobId.includes(':')
                ? upload.jobId.split(':').slice(1).join(':')
                : upload.jobId;
            const job = await this.uploadQueue.getJob(bullJobId);
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
        try {
            const bullJobId = upload.jobId.includes(':')
                ? upload.jobId.split(':').slice(1).join(':')
                : upload.jobId;
            const job = await this.uploadQueue.getJob(bullJobId);
            if (job) await job.remove();
        } catch (e) { }
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
