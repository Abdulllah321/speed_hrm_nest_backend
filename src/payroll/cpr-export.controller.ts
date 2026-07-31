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
import { CprTaxExportService } from './cpr-export.service';

@ApiTags('CPR Tax Export')
@Controller('api/cpr-taxes/export')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CprTaxExportController {
  constructor(private readonly exportService: CprTaxExportService) {}

  /**
   * POST /api/cpr-taxes/export
   * Queues a background export job. Returns immediately with a jobId.
   * User receives an in-app notification when the file is ready.
   */
  @Post()
  @Permissions('hr.payroll.read')
  @ApiOperation({ summary: 'Queue a CPR tax export job (returns immediately, notifies when done)' })
  async queueExport(
    @Req() req: any,
    @Query('search') search?: string,
    @Query('month')  month?: string,
    @Query('year')   year?: string,
    @Query('months') months?: string,
  ) {
    const result = await this.exportService.queueExport({
      userId: req.user?.userId,
      search,
      month,
      year,
      months,
    });

    return {
      status: true,
      message: "Export queued. You'll receive a notification when your file is ready.",
      data: result,
    };
  }

  /**
   * GET /api/cpr-taxes/export/:jobId/status
   */
  @Get(':jobId/status')
  @Permissions('hr.payroll.read')
  @ApiOperation({ summary: 'Check CPR tax export job status' })
  async getStatus(@Param('jobId') jobId: string) {
    const result = await this.exportService.getJobStatus(jobId);
    return { status: true, data: result };
  }

  /**
   * GET /api/cpr-taxes/export/:jobId/download
   * Streams the completed Excel file. Auto-deletes after download.
   */
  @Get(':jobId/download')
  @Permissions('hr.payroll.read')
  @ApiOperation({ summary: 'Download a completed CPR tax export file' })
  async download(@Param('jobId') jobId: string, @Res() res: any) {
    try {
      await this.exportService.streamExportFile(jobId, res);
    } catch (err: any) {
      const status = err?.status ?? 404;
      res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
    }
  }
}
