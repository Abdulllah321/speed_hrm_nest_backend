import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';

export interface QueueGeneralLedgerExportOptions {
  userId: string;
  accountId: string;
  from?: string;
  to?: string;
  sourceType?: string;
}

@Injectable()
export class GeneralLedgerExportService {
  private readonly logger = new Logger(GeneralLedgerExportService.name);

  constructor(
    @InjectQueue('general-ledger-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async queueExport(opts: QueueGeneralLedgerExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();

    // Read tenant database URL and tenant ID from request context (PrismaContext)
    const tenantId    = this.prisma.getTenantId()    ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    await this.exportQueue.add(
      {
        jobId,
        userId: opts.userId,
        tenantId,
        tenantDbUrl,
        accountId: opts.accountId,
        from: opts.from,
        to: opts.to,
        sourceType: opts.sourceType,
      },
      {
        jobId,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
        timeout: 2 * 60 * 60 * 1000, // 2 hours timeout max
      },
    );

    this.logger.log(`[GeneralLedgerExport] Queued job ${jobId} for user ${opts.userId} (tenant: ${tenantId}, account: ${opts.accountId})`);
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
    const filename  = `general-ledger-export-${timestamp}.xlsx`;

    const stream = fs.createReadStream(filePath);
    stream.on('close', () => {
      fs.unlink(filePath, (err) => {
        if (err) this.logger.warn(`Could not delete export file: ${err.message}`);
        else     this.logger.log(`[GeneralLedgerExport] Cleaned up ${filePath}`);
      });
    });
    stream.on('error', (err) => {
      this.logger.error(`[GeneralLedgerExport] Stream error: ${err.message}`);
    });

    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename="${filename}"`);
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(stream);
  }
}
