import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadService } from '../../upload/upload.service';
import { ExportHistoryService } from '../export-history/export-history.service';

export interface QueueStockTransactionDetailExportOptions {
  userId: string;
  locationId?: string;
  warehouseId?: string;
  itemId?: string;
  startDate?: string;
  endDate?: string;
  format: 'xlsx' | 'pdf';
  search?: string;
  showBrand?: boolean;
  showDivision?: boolean;
  showCategory?: boolean;
  showGender?: boolean;
  showSilhouette?: boolean;
  showArticle?: boolean;
  showVariant?: boolean;
}

@Injectable()
export class StockTransactionDetailExportService {
  private readonly logger = new Logger(StockTransactionDetailExportService.name);
  private readonly cancelledPreviewJobIds = new Set<string>();

  constructor(
    @InjectQueue('stock-transaction-detail-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
    private readonly exportHistoryService: ExportHistoryService,
  ) {}

  isJobCancelled(jobId?: string): boolean {
    if (!jobId) return false;
    return this.cancelledPreviewJobIds.has(jobId);
  }

  cancelReportPreview(jobId: string): void {
    if (jobId) {
      this.cancelledPreviewJobIds.add(jobId);
    }
  }

  async queueReportPreview(opts: {
    userId: string;
    locationId?: string;
    warehouseId?: string;
    itemId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
    showBrand?: boolean;
    showDivision?: boolean;
    showCategory?: boolean;
    showGender?: boolean;
    showSilhouette?: boolean;
    showArticle?: boolean;
    showVariant?: boolean;
  }): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    this.cancelledPreviewJobIds.delete(jobId);

    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    // Prune superseded waiting or active preview jobs for this user
    if (opts.userId) {
      try {
        const [waitingJobs, activeJobs] = await Promise.all([
          this.exportQueue.getWaiting(),
          this.exportQueue.getActive(),
        ]);

        for (const wJob of waitingJobs) {
          if (
            wJob.name === 'generate-report-preview' &&
            wJob.data?.userId === opts.userId
          ) {
            this.logger.log(`Pruning superseded waiting stock transaction detail preview job ${wJob.id} for user ${opts.userId}`);
            if (wJob.data?.jobId) this.cancelledPreviewJobIds.add(wJob.data.jobId);
            await wJob.remove();
          }
        }

        for (const aJob of activeJobs) {
          if (
            aJob.name === 'generate-report-preview' &&
            aJob.data?.userId === opts.userId
          ) {
            const activeJobId = aJob.data?.jobId;
            this.logger.log(`Cancelling active running stock transaction detail preview job ${activeJobId} for user ${opts.userId}`);
            if (activeJobId) this.cancelledPreviewJobIds.add(activeJobId);
          }
        }
      } catch (err: any) {
        this.logger.warn(`Could not prune stock transaction detail preview jobs for user ${opts.userId}: ${err.message}`);
      }
    }

    await this.exportQueue.add(
      'generate-report-preview',
      {
        jobId,
        userId: opts.userId,
        tenantId,
        tenantDbUrl,
        locationId: opts.locationId,
        warehouseId: opts.warehouseId,
        itemId: opts.itemId,
        startDate: opts.startDate,
        endDate: opts.endDate,
        search: opts.search,
        showBrand: opts.showBrand,
        showDivision: opts.showDivision,
        showCategory: opts.showCategory,
        showGender: opts.showGender,
        showSilhouette: opts.showSilhouette,
        showArticle: opts.showArticle,
        showVariant: opts.showVariant,
      },
      {
        jobId,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    this.logger.log(`[StockTransactionDetailPreview ${jobId}] Queued background computation for user ${opts.userId}`);
    return { jobId };
  }

  saveReportPreviewResult(jobId: string, data: any): void {
    const previewDir = path.join(process.cwd(), 'uploads', 'previews');
    if (!fs.existsSync(previewDir)) {
      fs.mkdirSync(previewDir, { recursive: true });
    }

    const cleanRoot = Array.isArray(data?.root) ? data.root : [];
    const payloadToSerialize = {
      root: cleanRoot,
      grandTotals: data?.grandTotals || { openingBalance: 0, closingBalance: 0, inTransitQty: 0 },
    };

    const jsonStr = JSON.stringify(payloadToSerialize, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v
    );
    const gzipped = zlib.gzipSync(jsonStr);
    const filePath = path.join(previewDir, `preview-${jobId}.json.gz`);
    fs.writeFileSync(filePath, gzipped);

    setTimeout(() => {
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      }
    }, 60 * 60 * 1000);
  }

  getReportPreviewResult(jobId: string): any {
    const filePath = path.join(process.cwd(), 'uploads', 'previews', `preview-${jobId}.json.gz`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const gzipped = fs.readFileSync(filePath);
    const jsonStr = zlib.gunzipSync(gzipped).toString('utf-8');
    return JSON.parse(jsonStr);
  }

  async getJobQueueStatus(jobId: string): Promise<{
    state: string;
    progress: number;
    message: string;
    queuePosition: number;
    waitingCount: number;
    failedReason?: string;
  }> {
    const job = await this.exportQueue.getJob(jobId);
    if (!job) {
      return { state: 'unknown', progress: 0, message: '', queuePosition: 0, waitingCount: 0 };
    }

    const state = await job.getState();
    const progressRaw = job.progress();
    let progress = 0;
    let message = '';

    if (typeof progressRaw === 'number') {
      progress = progressRaw;
    } else if (typeof progressRaw === 'object' && progressRaw !== null) {
      progress = (progressRaw as any).percent || 0;
      message = (progressRaw as any).message || '';
    }

    let queuePosition = 0;
    let waitingCount = 0;

    if (state === 'waiting' || state === 'delayed') {
      const [waiting, active] = await Promise.all([
        this.exportQueue.getWaiting(),
        this.exportQueue.getActive(),
      ]);
      waitingCount = waiting.length;
      const allJobs = [...active, ...waiting];
      const idx = allJobs.findIndex((j) => j.id?.toString() === jobId);
      queuePosition = idx >= 0 ? idx + 1 : 1;
    }

    return {
      state,
      progress,
      message,
      queuePosition,
      waitingCount,
      failedReason: job.failedReason,
    };
  }

  async queueExport(opts: QueueStockTransactionDetailExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const ext = opts.format === 'pdf' ? 'pdf' : 'xlsx';

    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: `stock-transaction-detail-report-${new Date().toISOString().slice(0, 10)}.${ext}`,
        filePath: path.join('uploads', 'exports', `export-${jobId}.${ext}`),
        moduleName: 'STOCK_TRANSACTION_DETAIL_REPORT',
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
        warehouseId: opts.warehouseId,
        itemId: opts.itemId,
        startDate: opts.startDate,
        endDate: opts.endDate,
        format: opts.format,
        search: opts.search,
        showBrand: opts.showBrand,
        showDivision: opts.showDivision,
        showCategory: opts.showCategory,
        showGender: opts.showGender,
        showSilhouette: opts.showSilhouette,
        showArticle: opts.showArticle,
        showVariant: opts.showVariant,
      },
      {
        jobId,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
        timeout: 2 * 60 * 60 * 1000,
      },
    );

    this.logger.log(`[StockTransactionDetailExport] Queued job ${jobId} for user ${opts.userId} (format: ${opts.format}, tenant: ${tenantId})`);
    return { jobId };
  }

  async registerClientGeneratedExport(opts: {
    userId: string;
    fileBuffer: Buffer;
    fileName: string;
    format: 'xlsx' | 'pdf' | 'html';
  }) {
    const jobId = uuidv4();
    const ext = opts.format === 'pdf' ? 'pdf' : (opts.format === 'html' ? 'html' : 'xlsx');
    const relativePath = path.join('uploads', 'exports', `export-${jobId}.${ext}`);
    const fullPath = path.join(process.cwd(), relativePath);

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, opts.fileBuffer);

    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: opts.fileName || `stock-transaction-detail-${new Date().toISOString().slice(0, 10)}.${ext}`,
        filePath: relativePath,
        moduleName: 'STOCK_TRANSACTION_DETAIL_REPORT',
        status: 'PENDING',
      },
    });

    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const prisma = (tenantId && tenantDbUrl)
      ? PrismaService.getTenantClient(tenantId, tenantDbUrl)
      : this.prisma;

    const mimeType = opts.format === 'pdf' ? 'application/pdf' : (opts.format === 'html' ? 'text/html' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    await this.exportHistoryService.completeAndUploadExport(
      prisma,
      jobId,
      fullPath,
      opts.fileName,
      mimeType,
    );

    return { status: true, jobId };
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

    try {
      await this.prisma.exportHistory.update({
        where: { id: jobId },
        data: {
          downloadCount: { increment: 1 },
        },
      });
    } catch (err: any) {
      this.logger.warn(`Could not update export history download count for job ${jobId}: ${err.message}`);
    }

    if (record.filePath.startsWith('s3://')) {
      const s3Key = record.filePath.replace('s3://', '');
      const signedUrl = await this.uploadService.getSignedUrlForDownload(s3Key);
      return res.redirect(signedUrl, 302);
    }

    if (record.filePath.startsWith('http://') || record.filePath.startsWith('https://')) {
      return res.redirect(record.filePath, 302);
    }

    const filePath = path.join(process.cwd(), record.filePath);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Export file not found. It may have expired or the job is still running.');
    }

    const stat = fs.statSync(filePath);

    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      this.logger.error(`[StockTransactionDetailExport] Stream error: ${err.message}`);
    });

    const isPdf = record.fileName.endsWith('.pdf');
    res.header('Content-Type', isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename="${record.fileName}"`);
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(stream);
  }
}
