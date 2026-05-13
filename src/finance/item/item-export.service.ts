import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../database/prisma.service';

export interface QueueExportOptions {
  userId: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  brandIds?: string[];
  categoryIds?: string[];
  silhouetteIds?: string[];
  genderIds?: string[];
}

@Injectable()
export class ItemExportService {
  private readonly logger = new Logger(ItemExportService.name);

  constructor(
    @InjectQueue('item-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async queueExport(opts: QueueExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();

    // Read tenant credentials from the live request context — same pattern as
    // ItemBulkUploadService. Never pass these through JWT; they live on the request.
    const tenantId  = this.prisma.getTenantId()  ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    await this.exportQueue.add(
      {
        jobId,
        userId: opts.userId,
        tenantId,
        tenantDbUrl,
        search: opts.search,
        sortBy: opts.sortBy,
        sortOrder: opts.sortOrder,
        brandIds: opts.brandIds,
        categoryIds: opts.categoryIds,
        silhouetteIds: opts.silhouetteIds,
        genderIds: opts.genderIds,
      },
      {
        jobId,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
        timeout: 2 * 60 * 60 * 1000, // 2 hours
      },
    );

    this.logger.log(`[Export] Queued job ${jobId} for user ${opts.userId} (tenant: ${tenantId})`);
    return { jobId };
  }

  async getJobStatus(jobId: string): Promise<{ state: string; progress: number }> {
    const job = await this.exportQueue.getJob(jobId);
    if (!job) throw new NotFoundException(`Export job ${jobId} not found`);
    const state = await job.getState();
    const progress = typeof job.progress() === 'number' ? (job.progress() as number) : 0;
    return { state, progress };
  }

  /**
   * Stream the completed export file to the response.
   * Deletes the file after streaming so disk doesn't fill up.
   */
  async streamExportFile(jobId: string, res: any): Promise<void> {
    const filePath = path.join(process.cwd(), 'uploads', 'exports', `export-${jobId}.xlsx`);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Export file not found. It may have expired or the job is still running.');
    }

    const stat = fs.statSync(filePath);
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `items-export-${timestamp}.xlsx`;

    const stream = fs.createReadStream(filePath);

    // Clean up file after the stream is fully consumed
    stream.on('close', () => {
      fs.unlink(filePath, (err) => {
        if (err) this.logger.warn(`Could not delete export file ${filePath}: ${err.message}`);
        else this.logger.log(`[Export] Cleaned up ${filePath}`);
      });
    });
    stream.on('error', (err) => {
      this.logger.error(`[Export] Stream error for ${filePath}: ${err.message}`);
    });

    // Use Fastify's res.send(stream) — this is the correct pattern.
    // res.header() + res.send() lets Fastify write headers and body together
    // through its own lifecycle, avoiding the raw-socket hijack issue that
    // causes "Failed to fetch" on the client.
    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename="${filename}"`);
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(stream);
  }
}
