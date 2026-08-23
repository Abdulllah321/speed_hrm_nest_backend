import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryAgingExportService } from './inventory-aging-export.service';

@Processor('inventory-aging-export')
export class InventoryAgingExportProcessor {
  private readonly logger = new Logger(InventoryAgingExportProcessor.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly inventoryAgingExportService: InventoryAgingExportService,
  ) {}

  @Process('generate-report-preview')
  async handleGenerateReportPreview(job: Job<any>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, locationId, warehouseId, startDate, endDate, reportType } = job.data;
    this.logger.log(`[InventoryAgingProcessor] Processing preview calculation for job ${jobId} (user: ${userId})`);

    const prisma = (tenantId && tenantDbUrl)
      ? PrismaService.getTenantClient(tenantId, tenantDbUrl)
      : this.prismaService;

    try {
      await job.progress({ percent: 5, message: 'Initializing aging engine...' });

      const onProgress = async (percent: number, message: string) => {
        if (this.inventoryAgingExportService.isJobCancelled(jobId)) {
          throw new Error('JOB_CANCELLED');
        }
        await job.progress({ percent, message });
      };

      const reportData = await this.inventoryAgingExportService.generateInventoryAgingDataInternal(prisma, {
        locationId,
        warehouseId,
        startDate,
        endDate,
        reportType,
        previewJobId: jobId,
        isAborted: () => this.inventoryAgingExportService.isJobCancelled(jobId),
        onProgress,
      });

      const dir = path.join(process.cwd(), 'uploads', 'previews');
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `preview-${jobId}.json.gz`);

      const jsonStr = JSON.stringify(reportData);
      const gzipped = zlib.gzipSync(Buffer.from(jsonStr, 'utf-8'));
      fs.writeFileSync(filePath, gzipped);

      await job.progress({ percent: 100, message: 'Preview calculation completed.' });
      this.logger.log(`[InventoryAgingProcessor] Successfully completed preview job ${jobId}`);
    } catch (err: any) {
      if (err.message === 'JOB_CANCELLED') {
        this.logger.log(`[InventoryAgingProcessor] Job ${jobId} was superseded or cancelled.`);
        return;
      }
      this.logger.error(`[InventoryAgingProcessor] Error processing preview job ${jobId}: ${err.message}`, err.stack);
      throw err;
    }
  }
}
