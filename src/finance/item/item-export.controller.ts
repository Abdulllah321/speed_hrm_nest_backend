import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ItemExportService } from './item-export.service';

@ApiTags('ERP Items Export')
@Controller('api/finance/items/export')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ItemExportController {
  constructor(private readonly exportService: ItemExportService) {}

  /**
   * POST /api/finance/items/export
   * Queues a background export job and returns immediately with a jobId.
   * The user will receive an in-app notification when the file is ready.
   */
  @Post()
  @Permissions('erp.item.read')
  @ApiOperation({ summary: 'Queue an items export job (returns immediately, notifies when done)' })
  async queueExport(
    @Req() req: any,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
    @Query('brandIds') brandIds?: string,
    @Query('categoryIds') categoryIds?: string,
    @Query('silhouetteIds') silhouetteIds?: string,
    @Query('genderIds') genderIds?: string,
  ) {
    const parseIds = (v?: string) => (v ? v.split(',').filter(Boolean) : undefined);

    const result = await this.exportService.queueExport({
      userId: req.user?.userId,
      search,
      sortBy,
      sortOrder: sortOrder as 'asc' | 'desc' | undefined,
      brandIds: parseIds(brandIds),
      categoryIds: parseIds(categoryIds),
      silhouetteIds: parseIds(silhouetteIds),
      genderIds: parseIds(genderIds),
    });

    return {
      status: true,
      message: "Export queued. You'll receive a notification when your file is ready.",
      data: result,
    };
  }

  /**
   * GET /api/finance/items/export/:jobId/status
   * Poll job progress (optional — the notification is the primary signal).
   */
  @Get(':jobId/status')
  @Permissions('erp.item.read')
  @ApiOperation({ summary: 'Check export job status' })
  async getStatus(@Param('jobId') jobId: string) {
    const result = await this.exportService.getJobStatus(jobId);
    return { status: true, data: result };
  }

  /**
   * GET /api/finance/items/export/:jobId/download
   * Streams the completed Excel file to the client.
   * File is deleted from disk after download.
   */
  @Get(':jobId/download')
  @Permissions('erp.item.read')
  @ApiOperation({ summary: 'Download a completed export file (streams from disk, auto-deletes after)' })
  async download(@Param('jobId') jobId: string, @Res() res: any) {
    try {
      await this.exportService.streamExportFile(jobId, res);
    } catch (err: any) {
      // When using @Res(), NestJS exception filters don't run — handle manually
      // so the socket is always closed cleanly (prevents "Failed to fetch" on client)
      const status = err?.status ?? 404;
      res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
    }
  }
}
