import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../database/prisma.service';
import { UploadService } from '../../upload/upload.service';

export interface QueuePurchaseOrderExportOptions {
  userId: string;
  poId?: string;
  status?: string;
  vendorId?: string;
  brandId?: string;
  orderType?: string;
  goodsType?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}

@Injectable()
export class PurchaseOrderExportService {
  private readonly logger = new Logger(PurchaseOrderExportService.name);

  constructor(
    @InjectQueue('purchase-order-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async queueExport(opts: QueuePurchaseOrderExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    let fileName = `purchase-order-${new Date().toISOString().slice(0, 10)}.xlsx`;

    // If specific PO ID is given, fetch PO number for prettier filename
    if (opts.poId) {
      try {
        const po = await this.prisma.purchaseOrder.findUnique({
          where: { id: opts.poId },
          select: { poNumber: true },
        });
        if (po?.poNumber) {
          fileName = `${po.poNumber}-${new Date().toISOString().slice(0, 10)}.xlsx`;
        }
      } catch (err: any) {
        this.logger.warn(`Could not resolve PO number for export filename: ${err.message}`);
      }
    }

    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName,
        filePath: path.join('uploads', 'exports', `export-${jobId}.xlsx`),
        moduleName: 'PURCHASE_ORDER_EXPORT',
        status: 'PENDING',
      },
    });

    await this.exportQueue.add(
      {
        jobId,
        userId: opts.userId,
        tenantId,
        tenantDbUrl,
        poId: opts.poId,
        status: opts.status,
        vendorId: opts.vendorId,
        brandId: opts.brandId,
        orderType: opts.orderType,
        goodsType: opts.goodsType,
        startDate: opts.startDate,
        endDate: opts.endDate,
        search: opts.search,
      },
      {
        jobId,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
        timeout: 2 * 60 * 60 * 1000,
      },
    );

    this.logger.log(`[PurchaseOrderExport] Queued job ${jobId} for user ${opts.userId}${opts.poId ? ` (PO: ${opts.poId})` : ''}`);
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
      throw new NotFoundException(`Export record ${jobId} not found`);
    }

    try {
      await this.prisma.exportHistory.update({
        where: { id: jobId },
        data: { downloadCount: { increment: 1 } },
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

    const filePath = path.join(process.cwd(), record.filePath);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Export file not found.');
    }

    const stat = fs.statSync(filePath);
    const stream = fs.createReadStream(filePath);

    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename="${record.fileName}"`);
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(stream);
  }
}
