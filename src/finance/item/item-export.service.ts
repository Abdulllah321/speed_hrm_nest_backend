import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../database/prisma.service';
import { UploadService } from '../../upload/upload.service';

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
    private readonly uploadService: UploadService,
  ) {}

  async queueExport(opts: QueueExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();

    // Read tenant credentials from the live request context — same pattern as
    // ItemBulkUploadService. Never pass these through JWT; they live on the request.
    const tenantId  = this.prisma.getTenantId()  ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    // Create pending export history record
    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: `items-export-${new Date().toISOString().slice(0, 10)}.xlsx`,
        filePath: path.join('uploads', 'exports', `export-${jobId}.xlsx`),
        moduleName: 'ITEMS_EXPORT',
        status: 'PENDING',
      },
    });

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

  async streamExportFile(jobId: string, res: any): Promise<void> {
    const record = await this.prisma.exportHistory.findUnique({
      where: { id: jobId },
      select: { fileName: true, filePath: true },
    });

    if (!record) {
      throw new NotFoundException(`Export record ${jobId} not found in database`);
    }

    // Increment download count in ExportHistory
    try {
      await this.prisma.exportHistory.update({
        where: { id: jobId },
        data: {
          downloadCount: { increment: 1 },
        },
      });
    } catch (err: any) {
      this.logger.warn(`Could not update export download count for job ${jobId}: ${err.message}`);
    }

    if (record.filePath.startsWith('s3://')) {
      const s3Key = record.filePath.replace('s3://', '');
      const signedUrl = await this.uploadService.getSignedUrlForDownload(s3Key);
      return res.redirect(signedUrl, 302);
    }

    if (record.filePath.startsWith('http://') || record.filePath.startsWith('https://')) {
      return res.redirect(record.filePath, 302);
    }

    const filePath = path.isAbsolute(record.filePath)
      ? record.filePath
      : path.join(process.cwd(), record.filePath);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Export file not found. It may have expired or the job is still running.');
    }

    const stat = fs.statSync(filePath);
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

    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename="${record.fileName}"`);
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(stream);
  }
}
