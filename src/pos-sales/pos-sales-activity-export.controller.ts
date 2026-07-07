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
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PosSalesActivityExportService } from './pos-sales-activity-export.service';
import * as jwt from 'jsonwebtoken';

@ApiTags('POS Sales Activity Export')
@Controller('api/pos-sales/activities/export')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class PosSalesActivityExportController {
  constructor(private readonly exportService: PosSalesActivityExportService) {}

  /**
   * POST /api/pos-sales/activities/export
   * Queues a background POS Sales Activity export job. Returns immediately with a jobId.
   */
  @Post()
  @Permissions('pos.sales.history.view')
  @ApiOperation({ summary: 'Queue a POS sales activity export job' })
  async queueExport(
    @Req() req: any,
    @Query('posId') posId?: string,
    @Query('activityType') activityType?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
  ) {
    // Determine effective filtering context (following logic in listActivities)
    let effectivePosId = posId;
    let effectiveLocationId: string | undefined = undefined;

    // 1. Context from logged-in user
    if (req.user?.isPosUser || req.user?.isTerminal) {
      if (!effectivePosId) effectivePosId = req.user.posId || req.user.terminalId;
      effectiveLocationId = req.user.locationId;
    }

    // 2. Fallback to terminal cookie
    if (!effectivePosId && req.cookies?.posTerminalToken) {
      try {
        const decoded: any = jwt.decode(req.cookies.posTerminalToken);
        effectivePosId = decoded?.posId || decoded?.terminalId;
        if (!effectiveLocationId) effectiveLocationId = decoded?.locationId;
      } catch (e) {}
    }

    // 3. Fallback: any user with a locationId on their token
    if (!effectiveLocationId && req.user?.locationId) {
      effectiveLocationId = req.user.locationId;
    }

    const result = await this.exportService.queueExport({
      userId: req.user?.userId || req.user?.id,
      posId: effectivePosId,
      activityType,
      filters: { startDate, endDate, search },
      locationId: effectiveLocationId,
    });

    return {
      status: true,
      message: "Activity log export queued. You'll receive a notification and can track progress.",
      data: result,
    };
  }

  /**
   * GET /api/pos-sales/activities/export/:jobId/status
   */
  @Get(':jobId/status')
  @Permissions('pos.sales.history.view')
  @ApiOperation({ summary: 'Check POS sales activity export status' })
  async getStatus(@Param('jobId') jobId: string) {
    const result = await this.exportService.getJobStatus(jobId);
    return { status: true, data: result };
  }

  /**
   * GET /api/pos-sales/activities/export/:jobId/download
   */
  @Get(':jobId/download')
  @Permissions('pos.sales.history.view')
  @ApiOperation({ summary: 'Download completed POS sales activity export file' })
  async download(@Param('jobId') jobId: string, @Res() res: any) {
    try {
      await this.exportService.streamExportFile(jobId, res);
    } catch (err: any) {
      const status = err?.status ?? 404;
      res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
    }
  }
}
