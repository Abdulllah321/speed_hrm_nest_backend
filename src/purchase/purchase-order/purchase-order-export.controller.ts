import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PurchaseOrderExportService } from './purchase-order-export.service';

@ApiTags('Purchase Order Export')
@Controller('api/purchase-order/export')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class PurchaseOrderExportController {
  constructor(private readonly exportService: PurchaseOrderExportService) {}

  /**
   * POST /api/purchase-order/export
   * Queues a background export job. Returns immediately with a jobId.
   * Supports specific PO export via poId or list filters.
   */
  @Post()
  @Permissions('erp.procurement.po.read')
  @ApiOperation({ summary: 'Queue a purchase order export job (returns immediately, notifies when done)' })
  async queueExport(
    @Req() req: any,
    @Body() body: {
      poId?: string;
      status?: string;
      vendorId?: string;
      brandId?: string;
      orderType?: string;
      goodsType?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
    },
    @Query('poId') poIdQuery?: string,
  ) {
    const poId = body?.poId || poIdQuery;
    const result = await this.exportService.queueExport({
      userId: req.user?.id || req.user?.userId,
      poId,
      status: body?.status,
      vendorId: body?.vendorId,
      brandId: body?.brandId,
      orderType: body?.orderType,
      goodsType: body?.goodsType,
      startDate: body?.startDate,
      endDate: body?.endDate,
      search: body?.search,
    });

    return {
      status: true,
      message: "Export queued. You'll receive a notification when your file is ready.",
      data: result,
    };
  }

  /**
   * POST /api/purchase-order/export/:poId
   * Queues a background export for a specific Purchase Order by ID.
   */
  @Post(':poId')
  @Permissions('erp.procurement.po.read')
  @ApiOperation({ summary: 'Queue export for a specific purchase order' })
  async queueSingleExport(@Param('poId') poId: string, @Req() req: any) {
    const result = await this.exportService.queueExport({
      userId: req.user?.id || req.user?.userId,
      poId,
    });

    return {
      status: true,
      message: "Export queued. You'll receive a notification when your file is ready.",
      data: result,
    };
  }

  /**
   * GET /api/purchase-order/export/:jobId/status
   */
  @Get(':jobId/status')
  @Permissions('erp.procurement.po.read')
  @ApiOperation({ summary: 'Check purchase order export job status' })
  async getStatus(@Param('jobId') jobId: string) {
    const result = await this.exportService.getJobStatus(jobId);
    return { status: true, data: result };
  }

  /**
   * GET /api/purchase-order/export/:jobId/download
   * Streams the completed Excel file.
   */
  @Get(':jobId/download')
  @Permissions('erp.procurement.po.read')
  @ApiOperation({ summary: 'Download a completed purchase order export file' })
  async download(@Param('jobId') jobId: string, @Res() res: any) {
    try {
      await this.exportService.streamExportFile(jobId, res);
    } catch (err: any) {
      const status = err?.status ?? 404;
      res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
    }
  }
}
