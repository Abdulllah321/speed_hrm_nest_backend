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
import { ChartOfAccountExportService } from './chart-of-account-export.service';

@ApiTags('Chart of Accounts Export')
@Controller('api/finance/chart-of-accounts/export')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ChartOfAccountExportController {
  constructor(private readonly exportService: ChartOfAccountExportService) {}

  /**
   * POST /api/finance/chart-of-accounts/export
   * Queues a background export job. Returns immediately with a jobId.
   * User receives an in-app notification when the file is ready.
   */
  @Post()
  @Permissions('erp.finance.chart-of-account.read')
  @ApiOperation({ summary: 'Queue a chart-of-accounts export job (returns immediately, notifies when done)' })
  async queueExport(
    @Req() req: any,
    @Query('search')   search?: string,
    @Query('type')     type?: string,
    @Query('isGroup')  isGroupStr?: string,
    @Query('isActive') isActiveStr?: string,
  ) {
    const parseBool = (v?: string): boolean | undefined => {
      if (v === 'true')  return true;
      if (v === 'false') return false;
      return undefined;
    };

    const result = await this.exportService.queueExport({
      userId:   req.user?.userId,
      search,
      type,
      isGroup:  parseBool(isGroupStr),
      isActive: parseBool(isActiveStr),
    });

    return {
      status: true,
      message: "Export queued. You'll receive a notification when your file is ready.",
      data: result,
    };
  }

  /**
   * GET /api/finance/chart-of-accounts/export/:jobId/status
   */
  @Get(':jobId/status')
  @Permissions('erp.finance.chart-of-account.read')
  @ApiOperation({ summary: 'Check chart-of-accounts export job status' })
  async getStatus(@Param('jobId') jobId: string) {
    const result = await this.exportService.getJobStatus(jobId);
    return { status: true, data: result };
  }

  /**
   * GET /api/finance/chart-of-accounts/export/:jobId/download
   * Streams the completed Excel file. Auto-deletes after download.
   */
  @Get(':jobId/download')
  @Permissions('erp.finance.chart-of-account.read')
  @ApiOperation({ summary: 'Download a completed chart-of-accounts export file' })
  async download(@Param('jobId') jobId: string, @Res() res: any) {
    try {
      await this.exportService.streamExportFile(jobId, res);
    } catch (err: any) {
      const status = err?.status ?? 404;
      res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
    }
  }
}
