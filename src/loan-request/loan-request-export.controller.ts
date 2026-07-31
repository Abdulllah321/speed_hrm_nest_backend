import {
  Controller,
  Post,
  Get,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { LoanRequestExportService } from './loan-request-export.service';

@ApiTags('Loan Request Export')
@Controller('api/loan-requests/export')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class LoanRequestExportController {
  constructor(private readonly exportService: LoanRequestExportService) {}

  /**
   * POST /api/loan-requests/export
   * Queues a background export job. Returns immediately with a jobId.
   * User receives an in-app notification when the file is ready.
   */
  @Post()
  @Permissions('hr.loan-request.read')
  @ApiOperation({ summary: 'Queue a loan request export job (returns immediately, notifies when done)' })
  async queueExport(@Req() req: any) {
    const result = await this.exportService.queueExport({
      userId: req.user?.userId,
    });

    return {
      status: true,
      message: "Export queued. You'll receive a notification when your file is ready.",
      data: result,
    };
  }

  /**
   * GET /api/loan-requests/export/:jobId/status
   */
  @Get(':jobId/status')
  @Permissions('hr.loan-request.read')
  @ApiOperation({ summary: 'Check loan request export job status' })
  async getStatus(@Param('jobId') jobId: string) {
    const result = await this.exportService.getJobStatus(jobId);
    return { status: true, data: result };
  }

  /**
   * GET /api/loan-requests/export/:jobId/download
   * Streams the completed Excel file. Auto-deletes after download.
   */
  @Get(':jobId/download')
  @Permissions('hr.loan-request.read')
  @ApiOperation({ summary: 'Download a completed loan request export file' })
  async download(@Param('jobId') jobId: string, @Res() res: any) {
    try {
      await this.exportService.streamExportFile(jobId, res);
    } catch (err: any) {
      const status = err?.status ?? 404;
      res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
    }
  }
}
