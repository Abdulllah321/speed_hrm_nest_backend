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
import { GeneralLedgerExportService } from './general-ledger-export.service';

@ApiTags('Finance Reports Export')
@Controller('api/finance/reports/general-ledger/export')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GeneralLedgerExportController {
  constructor(private readonly exportService: GeneralLedgerExportService) {}

  /**
   * POST /api/finance/reports/general-ledger/export/queue
   * Queues a background General Ledger export job. Returns immediately with a jobId.
   * User receives an in-app notification when the file is ready.
   */
  @Post('queue')
  @ApiOperation({ summary: 'Queue a general ledger export job' })
  @ApiQuery({ name: 'accountId', required: true, type: String })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  @ApiQuery({ name: 'sourceType', required: false, type: String })
  async queueExport(
    @Req() req: any,
    @Query('accountId') accountId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('sourceType') sourceType?: string,
  ) {
    const result = await this.exportService.queueExport({
      userId: req.user?.userId,
      accountId,
      from,
      to,
      sourceType,
    });

    return {
      status: true,
      message: "Export queued. You'll receive a notification when your file is ready.",
      data: result,
    };
  }

  /**
   * GET /api/finance/reports/general-ledger/export/:jobId/status
   */
  @Get(':jobId/status')
  @ApiOperation({ summary: 'Check general ledger export job status' })
  async getStatus(@Param('jobId') jobId: string) {
    const result = await this.exportService.getJobStatus(jobId);
    return { status: true, data: result };
  }

  /**
   * GET /api/finance/reports/general-ledger/export/:jobId/download
   * Streams the completed Excel file. Auto-deletes after download.
   */
  @Get(':jobId/download')
  @ApiOperation({ summary: 'Download a completed general ledger export file' })
  async download(@Param('jobId') jobId: string, @Res() res: any) {
    try {
      await this.exportService.streamExportFile(jobId, res);
    } catch (err: any) {
      const status = err?.status ?? 404;
      res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
    }
  }
}
