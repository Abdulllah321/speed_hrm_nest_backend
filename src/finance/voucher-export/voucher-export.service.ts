import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../database/prisma.service';

// ── Journal Voucher ──────────────────────────────────────────────────────────
export interface QueueJvExportOptions {
  userId: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

// ── Payment Voucher ──────────────────────────────────────────────────────────
export interface QueuePvExportOptions {
  userId: string;
  type?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

// ── Receipt Voucher ──────────────────────────────────────────────────────────
export interface QueueRvExportOptions {
  userId: string;
  type?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

@Injectable()
export class VoucherExportService {
  private readonly logger = new Logger(VoucherExportService.name);

  constructor(
    @InjectQueue('journal-voucher-export') private readonly jvQueue: Queue,
    @InjectQueue('payment-voucher-export') private readonly pvQueue: Queue,
    @InjectQueue('receipt-voucher-export') private readonly rvQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  // ── Queue helpers ──────────────────────────────────────────────────────────

  async queueJvExport(opts: QueueJvExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId    = this.prisma.getTenantId()    ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    await this.jvQueue.add(
      { jobId, tenantId, tenantDbUrl, ...opts },
      { jobId, attempts: 1, removeOnComplete: false, removeOnFail: false, timeout: 2 * 60 * 60 * 1000 },
    );

    this.logger.log(`[JvExport] Queued job ${jobId} for user ${opts.userId}`);
    return { jobId };
  }

  async queuePvExport(opts: QueuePvExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId    = this.prisma.getTenantId()    ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    await this.pvQueue.add(
      { jobId, tenantId, tenantDbUrl, ...opts },
      { jobId, attempts: 1, removeOnComplete: false, removeOnFail: false, timeout: 2 * 60 * 60 * 1000 },
    );

    this.logger.log(`[PvExport] Queued job ${jobId} for user ${opts.userId}`);
    return { jobId };
  }

  async queueRvExport(opts: QueueRvExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId    = this.prisma.getTenantId()    ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    await this.rvQueue.add(
      { jobId, tenantId, tenantDbUrl, ...opts },
      { jobId, attempts: 1, removeOnComplete: false, removeOnFail: false, timeout: 2 * 60 * 60 * 1000 },
    );

    this.logger.log(`[RvExport] Queued job ${jobId} for user ${opts.userId}`);
    return { jobId };
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  private async getStatus(queue: Queue, jobId: string) {
    const job = await queue.getJob(jobId);
    if (!job) throw new NotFoundException(`Export job ${jobId} not found`);
    const state    = await job.getState();
    const progress = typeof job.progress() === 'number' ? (job.progress() as number) : 0;
    return { state, progress };
  }

  async getJvJobStatus(jobId: string) { return this.getStatus(this.jvQueue, jobId); }
  async getPvJobStatus(jobId: string) { return this.getStatus(this.pvQueue, jobId); }
  async getRvJobStatus(jobId: string) { return this.getStatus(this.rvQueue, jobId); }

  // ── Download (shared) ──────────────────────────────────────────────────────

  async streamExportFile(jobId: string, filename: string, res: any): Promise<void> {
    const filePath = path.join(process.cwd(), 'uploads', 'exports', `export-${jobId}.xlsx`);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Export file not found. It may have expired or the job is still running.');
    }

    const stat = fs.statSync(filePath);
    const stream = fs.createReadStream(filePath);

    stream.on('close', () => {
      fs.unlink(filePath, (err) => {
        if (err) this.logger.warn(`Could not delete export file: ${err.message}`);
        else     this.logger.log(`[VoucherExport] Cleaned up ${filePath}`);
      });
    });
    stream.on('error', (err) => {
      this.logger.error(`[VoucherExport] Stream error: ${err.message}`);
    });

    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename="${filename}"`);
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(stream);
  }
}
