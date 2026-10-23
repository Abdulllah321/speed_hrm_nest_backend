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
    const {
      jobId,
      userId,
      tenantId,
      tenantDbUrl,
      locationId,
      warehouseId,
      startDate,
      endDate,
      asOfDate,
      fiscalYear,
      reportType,
    } = job.data;
    this.logger.log(
      `[InventoryAgingProcessor] Processing preview calculation for job ${jobId} (user: ${userId})`,
    );

    const filePath =
      this.inventoryAgingExportService.getPreviewFilePath(jobId);
    if (fs.existsSync(filePath)) {
      this.logger.log(
        `[InventoryAgingProcessor] Preview result already generated for ${jobId}. Skipping.`,
      );
      return;
    }

    if (this.inventoryAgingExportService.isJobCancelled(jobId)) {
      this.logger.log(
        `[InventoryAgingProcessor] Job ${jobId} was cancelled before starting. Skipping.`,
      );
      return;
    }

    const safeProgress = async (percent: number, message: string) => {
      try {
        if (!this.inventoryAgingExportService.isJobCancelled(jobId)) {
          await job.progress({ percent, message });
        }
      } catch (err: any) {
        this.logger.warn(
          `[InventoryAgingProcessor] Progress update suppressed for ${jobId}: ${err.message}`,
        );
      }
    };

    const prisma =
      tenantId && tenantDbUrl
        ? PrismaService.getTenantClient(tenantId, tenantDbUrl)
        : this.prismaService;

    try {
      await safeProgress(5, 'Initializing aging engine...');

      const onProgress = async (percent: number, message: string) => {
        if (this.inventoryAgingExportService.isJobCancelled(jobId)) {
          throw new Error('JOB_CANCELLED');
        }
        await safeProgress(percent, message);
      };

      const reportData =
        await this.inventoryAgingExportService.generateInventoryAgingDataInternal(
          prisma,
          {
            locationId,
            warehouseId,
            startDate,
            endDate,
            asOfDate,
            fiscalYear,
            reportType,
            previewJobId: jobId,
            isAborted: () =>
              this.inventoryAgingExportService.isJobCancelled(jobId),
            onProgress,
          },
        );

      const dir = path.join(process.cwd(), 'uploads', 'previews');
      fs.mkdirSync(dir, { recursive: true });

      const payload =
        (reportData as any)?.status !== undefined
          ? reportData
          : { status: true, data: reportData };
      const jsonStr = JSON.stringify(payload);
      const gzipped = zlib.gzipSync(Buffer.from(jsonStr, 'utf-8'));
      fs.writeFileSync(filePath, gzipped);

      await safeProgress(100, 'Preview calculation completed.');
      this.logger.log(
        `[InventoryAgingProcessor] Successfully completed preview job ${jobId}`,
      );
    } catch (err: any) {
      if (
        err.message === 'JOB_CANCELLED' ||
        this.inventoryAgingExportService.isJobCancelled(jobId)
      ) {
        this.logger.log(
          `[InventoryAgingProcessor] Job ${jobId} was superseded or cancelled.`,
        );
        return;
      }
      this.logger.error(
        `[InventoryAgingProcessor] Error processing preview job ${jobId}: ${err.message}`,
        err.stack,
      );
      throw err;
    }
  }
}
