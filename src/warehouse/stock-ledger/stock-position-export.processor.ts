import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { StockPositionExportService } from './stock-position-export.service';

export interface StockPositionPreviewJobData {
  jobId: string;
  userId: string;
  userRole?: string;
  tenantId: string;
  tenantDbUrl: string;
  locationId?: string;
  warehouseId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  brandIds?: string[];
}

@Processor('stock-position-export')
export class StockPositionExportProcessor {
  private readonly logger = new Logger(StockPositionExportProcessor.name);

  constructor(
    private readonly stockPositionExportService: StockPositionExportService,
  ) {}

  @Process('generate-stock-position-preview')
  async handleGeneratePreview(
    job: Job<StockPositionPreviewJobData>,
  ): Promise<void> {
    const {
      jobId,
      userId,
      userRole,
      tenantId,
      tenantDbUrl,
      locationId,
      warehouseId,
      startDate,
      endDate,
      search,
      brandIds,
    } = job.data;
    this.logger.log(
      `[StockPositionPreview ${jobId}] Starting background stock-position preview computation (user: ${userId}, role: ${userRole || 'N/A'})`,
    );

    const prisma =
      tenantId && tenantDbUrl
        ? PrismaService.getTenantClient(tenantId, tenantDbUrl)
        : new PrismaService({ tenantId, tenantDbUrl } as any);

    try {
      await job.progress({
        percent: 10,
        message: 'Queueing preview computation task...',
      });

      const result =
        await this.stockPositionExportService.generateStockPositionReportDataInternal(
          prisma as any,
          {
            userId,
            userRole,
            brandIds,
            locationId,
            warehouseId,
            startDate,
            endDate,
            search,
            onProgress: async (percent, message) => {
              await job.progress({ percent, message });
            },
          },
        );

      await this.stockPositionExportService.saveReportPreviewResult(
        jobId,
        result,
      );
      await job.progress({
        percent: 100,
        message: 'Stock Position report preview ready!',
      });
      this.logger.log(
        `[StockPositionPreview ${jobId}] Successfully generated and saved preview result`,
      );
    } catch (err: any) {
      this.logger.error(
        `[StockPositionPreview ${jobId}] Failed to compute preview: ${err.message}`,
        err.stack,
      );
      throw err;
    }
  }
}
