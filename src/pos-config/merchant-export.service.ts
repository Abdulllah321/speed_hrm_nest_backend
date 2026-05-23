import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../database/prisma.service';

export interface QueueMerchantExportOptions {
    userId: string;
    search?: string;
    locationId?: string;
    bankName?: string;
    isActive?: boolean;
}

@Injectable()
export class MerchantExportService {
    private readonly logger = new Logger(MerchantExportService.name);

    constructor(
        @InjectQueue('merchant-export') private readonly exportQueue: Queue,
        private readonly prisma: PrismaService,
    ) { }

    async queueExport(opts: QueueMerchantExportOptions): Promise<{ jobId: string }> {
        const jobId = uuidv4();

        // Read tenant credentials from the live request context
        const tenantId    = this.prisma.getTenantId()    ?? '';
        const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

        await this.exportQueue.add(
            {
                jobId,
                userId: opts.userId,
                tenantId,
                tenantDbUrl,
                search:     opts.search,
                locationId: opts.locationId,
                bankName:   opts.bankName,
                isActive:   opts.isActive,
            },
            {
                jobId,
                attempts: 1,
                removeOnComplete: false,
                removeOnFail: false,
                timeout: 2 * 60 * 60 * 1000,
            },
        );

        this.logger.log(`[MerchantExport] Queued job ${jobId} for user ${opts.userId} (tenant: ${tenantId})`);
        return { jobId };
    }

    async getJobStatus(jobId: string): Promise<{ state: string; progress: number }> {
        const job = await this.exportQueue.getJob(jobId);
        if (!job) throw new NotFoundException(`Export job ${jobId} not found`);
        const state    = await job.getState();
        const progress = typeof job.progress() === 'number' ? (job.progress() as number) : 0;
        return { state, progress };
    }

    async streamExportFile(jobId: string, res: any): Promise<void> {
        const filePath = path.join(process.cwd(), 'uploads', 'exports', `export-${jobId}.xlsx`);

        if (!fs.existsSync(filePath)) {
            throw new NotFoundException('Export file not found. It may have expired or the job is still running.');
        }

        const stat      = fs.statSync(filePath);
        const timestamp = new Date().toISOString().slice(0, 10);
        const filename  = `merchants-export-${timestamp}.xlsx`;

        const stream = fs.createReadStream(filePath);
        stream.on('close', () => {
            fs.unlink(filePath, (err) => {
                if (err) this.logger.warn(`Could not delete export file: ${err.message}`);
                else     this.logger.log(`[MerchantExport] Cleaned up ${filePath}`);
            });
        });
        stream.on('error', (err) => {
            this.logger.error(`[MerchantExport] Stream error: ${err.message}`);
        });

        res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.header('Content-Disposition', `attachment; filename="${filename}"`);
        res.header('Content-Length', stat.size);
        res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.send(stream);
    }
}
