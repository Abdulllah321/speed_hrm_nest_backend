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
import { LocationExportService } from './location-export.service';

@ApiTags('Location Export')
@Controller('api/locations/export')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class LocationExportController {
  constructor(private readonly exportService: LocationExportService) {}

  /**
   * POST /api/locations/export
   * Queues a background location export job. Returns immediately with a jobId.
   * User receives an in-app notification when the file is ready.
   */
  @Post()
  @Permissions('master.location.read')
  @ApiOperation({ summary: 'Queue a location export job (returns immediately, notifies when done)' })
  async queueExport(
    @Req() req: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('isOnline') isOnline?: string,
    @Query('isStockLocation') isStockLocation?: string,
  ) {
    const result = await this.exportService.queueExport({
      userId: req.user?.userId || req.user?.id,
      search,
      status,
      isOnline,
      isStockLocation,
    });

    return {
      status: true,
      message: "Export queued. You'll receive a notification when your file is ready.",
      data: result,
    };
  }

  /**
   * GET /api/locations/export/:jobId/status
   */
  @Get(':jobId/status')
  @Permissions('master.location.read')
  @ApiOperation({ summary: 'Check location export job status' })
  async getStatus(@Param('jobId') jobId: string) {
    const result = await this.exportService.getJobStatus(jobId);
    return { status: true, data: result };
  }

  /**
   * GET /api/locations/export/:jobId/download
   * Streams the completed Excel file. Auto-deletes after download.
   */
  @Get(':jobId/download')
  @Permissions('master.location.read')
  @ApiOperation({ summary: 'Download a completed location export file' })
  async download(@Param('jobId') jobId: string, @Res() res: any) {
    try {
      await this.exportService.streamExportFile(jobId, res);
    } catch (err: any) {
      const status = err?.status ?? 404;
      res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
    }
  }
}
