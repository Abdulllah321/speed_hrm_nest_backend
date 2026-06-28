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
import { DeliveryNoteExportService } from './delivery-note-export.service';

@ApiTags('Delivery Note Export')
@Controller('api/transfer-request/export')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class DeliveryNoteExportController {
  constructor(private readonly exportService: DeliveryNoteExportService) {}

  /**
   * POST /api/transfer-request/export
   * Queues a background export job. Returns immediately with a jobId.
   * User receives an in-app notification when the file is ready.
   */
  @Post()
  @Permissions('erp.inventory.stock-transfer.read', 'erp.inventory.delivery-note.read')
  @ApiOperation({ summary: 'Queue a delivery note export job (returns immediately, notifies when done)' })
  async queueExport(
    @Req() req: any,
    @Query('warehouseId')  warehouseId?: string,
    @Query('status')       status?: string,
    @Query('transferType') transferType?: string,
    @Query('search')       search?: string,
    @Query('dateFrom')     dateFrom?: string,
    @Query('dateTo')       dateTo?: string,
  ) {
    const result = await this.exportService.queueExport({
      userId: req.user?.userId || req.user?.id || 'system',
      warehouseId,
      status,
      transferType,
      search,
      dateFrom,
      dateTo,
    });

    return {
      status: true,
      message: "Export queued. You'll receive a notification when your file is ready.",
      data: result,
    };
  }

  /**
   * GET /api/transfer-request/export/:jobId/status
   */
  @Get(':jobId/status')
  @Permissions('erp.inventory.stock-transfer.read', 'erp.inventory.delivery-note.read')
  @ApiOperation({ summary: 'Check delivery note export job status' })
  async getStatus(@Param('jobId') jobId: string) {
    const result = await this.exportService.getJobStatus(jobId);
    return { status: true, data: result };
  }

  /**
   * GET /api/transfer-request/export/:jobId/download
   * Streams the completed Excel file. Auto-deletes after download.
   */
  @Get(':jobId/download')
  @Permissions('erp.inventory.stock-transfer.read', 'erp.inventory.delivery-note.read')
  @ApiOperation({ summary: 'Download a completed delivery note export file' })
  async download(@Param('jobId') jobId: string, @Res() res: any) {
    try {
      await this.exportService.streamExportFile(jobId, res);
    } catch (err: any) {
      const status = err?.status ?? 404;
      res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
    }
  }
}
