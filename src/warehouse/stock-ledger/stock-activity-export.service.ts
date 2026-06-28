import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';

export interface QueueStockActivityExportOptions {
  userId: string;
  locationId: string;
  startDate?: string;
  endDate?: string;
}

@Injectable()
export class StockActivityExportService {
  private readonly logger = new Logger(StockActivityExportService.name);

  constructor(
    @InjectQueue('stock-activity-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async queueExport(opts: QueueStockActivityExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    // Save export job request in history audit table
    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: `stock-activity-report-${new Date().toISOString().slice(0, 10)}.xlsx`,
        filePath: path.join('uploads', 'exports', `export-${jobId}.xlsx`),
        moduleName: 'STOCK_ACTIVITY_REPORT',
        status: 'PENDING',
      },
    });

    await this.exportQueue.add(
      {
        jobId,
        userId: opts.userId,
        tenantId,
        tenantDbUrl,
        locationId: opts.locationId,
        startDate: opts.startDate,
        endDate: opts.endDate,
      },
      {
        jobId,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
        timeout: 2 * 60 * 60 * 1000,
      },
    );

    this.logger.log(`[StockActivityExport] Queued job ${jobId} for user ${opts.userId} (tenant: ${tenantId})`);
    return { jobId };
  }

  async getJobStatus(jobId: string): Promise<{ state: string; progress: number }> {
    const job = await this.exportQueue.getJob(jobId);
    if (!job) throw new NotFoundException(`Export job ${jobId} not found`);
    const state = await job.getState();
    const progress = typeof job.progress() === 'number' ? (job.progress() as number) : 0;
    return { state, progress };
  }

  async streamExportFile(jobId: string, res: any): Promise<void> {
    const filePath = path.join(process.cwd(), 'uploads', 'exports', `export-${jobId}.xlsx`);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Export file not found. It may have expired or the job is still running.');
    }

    const stat = fs.statSync(filePath);
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `stock-activity-report-${timestamp}.xlsx`;

    // Increment download count in ExportHistory
    try {
      await this.prisma.exportHistory.update({
        where: { id: jobId },
        data: {
          downloadCount: { increment: 1 },
        },
      });
    } catch (err) {
      this.logger.warn(`Could not update export history download count for job ${jobId}: ${err.message}`);
    }

    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      this.logger.error(`[StockActivityExport] Stream error: ${err.message}`);
    });

    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename="${filename}"`);
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(stream);
  }
}
