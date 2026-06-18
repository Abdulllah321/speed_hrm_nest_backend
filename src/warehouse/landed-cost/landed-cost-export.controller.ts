import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  Body,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LandedCostExportService } from './landed-cost-export.service';

@ApiTags('Landed Cost Export')
@Controller('api/landed-cost/export')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class LandedCostExportController {
  constructor(private readonly exportService: LandedCostExportService) {}

  /**
   * POST /api/landed-cost/export/:id
   * Queues a background export job for a specific landed cost record.
   */
  @Post(':id')
  @ApiOperation({ summary: 'Queue a landed cost detailed ledger export job (returns jobId)' })
  async queueExport(
    @Req() req: any,
    @Param('id') landedCostId: string,
    @Body() body: { search?: string; hsCodes?: string[]; skus?: string[] },
  ) {
    const userId = req.user?.userId || req.user?.id;
    const result = await this.exportService.queueExport({
      userId,
      landedCostId,
      search:  body.search,
      hsCodes: body.hsCodes,
      skus:    body.skus,
    });

    return {
      status: true,
      message: "Landed cost export queued. You'll receive a notification when the Excel sheet is ready.",
      data: result,
    };
  }

  /**
   * GET /api/landed-cost/export/:jobId/status
   */
  @Get(':jobId/status')
  @ApiOperation({ summary: 'Check landed cost export job status' })
  async getStatus(@Param('jobId') jobId: string) {
    const result = await this.exportService.getJobStatus(jobId);
    return { status: true, data: result };
  }

  /**
   * GET /api/landed-cost/export/:jobId/download
   */
  @Get(':jobId/download')
  @ApiOperation({ summary: 'Download a completed landed cost export file' })
  async download(@Param('jobId') jobId: string, @Res() res: any) {
    try {
      await this.exportService.streamExportFile(jobId, res);
    } catch (err: any) {
      const status = err?.status ?? 404;
      res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
    }
  }
}
