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
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TrialBalanceExportService } from './trial-balance-export.service';

@ApiTags('Finance Reports Export')
@Controller('api/finance/reports/trial-balance/export')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TrialBalanceExportController {
  constructor(private readonly exportService: TrialBalanceExportService) {}

  /**
   * POST /api/finance/reports/trial-balance/export/queue
   * Queues a background Trial Balance export job. Returns immediately with a jobId.
   * User receives an in-app notification when the file is ready.
   */
  @Post('queue')
  @ApiOperation({ summary: 'Queue a trial balance export job (returns immediately, notifies when done)' })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  @ApiQuery({ name: 'includeTagAccounts', required: false, type: Boolean })
  @ApiQuery({ name: 'reportType', required: false, type: String, enum: ['OPENING', 'CLOSING', 'DETAILED'] })
  async queueExport(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('includeTagAccounts') includeTagAccounts?: string,
    @Query('reportType') reportType?: 'OPENING' | 'CLOSING' | 'DETAILED',
  ) {
    const isIncludeTags = includeTagAccounts === 'true';
    const result = await this.exportService.queueExport({
      userId: req.user?.userId,
      from,
      to,
      includeTagAccounts: isIncludeTags,
      reportType,
    });

    return {
      status: true,
      message: "Export queued. You'll receive a notification when your file is ready.",
      data: result,
    };
  }

  /**
   * GET /api/finance/reports/trial-balance/export/:jobId/status
   */
  @Get(':jobId/status')
  @ApiOperation({ summary: 'Check trial balance export job status' })
  async getStatus(@Param('jobId') jobId: string) {
    const result = await this.exportService.getJobStatus(jobId);
    return { status: true, data: result };
  }

  /**
   * GET /api/finance/reports/trial-balance/export/:jobId/download
   * Streams the completed Excel file. Auto-deletes after download.
   */
  @Get(':jobId/download')
  @ApiOperation({ summary: 'Download a completed trial balance export file' })
  async download(@Param('jobId') jobId: string, @Res() res: any) {
    try {
      await this.exportService.streamExportFile(jobId, res);
    } catch (err: any) {
      const status = err?.status ?? 404;
      res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
    }
  }
}
