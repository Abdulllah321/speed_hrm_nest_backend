import { Controller, Get, Post, Query, Param, Req, Res, UseGuards, Body } from '@nestjs/common';
import { StockLedgerService } from './stock-ledger.service';
import { StockActivityExportService } from './stock-activity-export.service';
import { StockValuationExportService } from './stock-valuation-export.service';
import { MovementType } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('api/stock-ledger')
export class StockLedgerController {
  constructor(
    private readonly stockLedgerService: StockLedgerService,
    private readonly stockActivityExportService: StockActivityExportService,
    private readonly stockValuationExportService: StockValuationExportService,
  ) { }

  @Get('levels')
  async getStockLevels(@Query('warehouseId') warehouseId?: string, @Query('locationId') locationId?: string) {
    return this.stockLedgerService.getStockLevels({ warehouseId, locationId });
  }

  @Get()
  async findAll(
    @Query('warehouseId') warehouseId?: string,
    @Query('locationId') locationId?: string,
    @Query('movementType') movementType?: MovementType,
    @Query('itemId') itemId?: string,
    @Query('referenceType') referenceType?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.stockLedgerService.findAll({
      warehouseId,
      locationId,
      movementType,
      itemId,
      referenceType,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
    });
  }

  @Post('export')
  @UseGuards(JwtAuthGuard)
  async queueExport(
    @Req() req: any,
    @Query('warehouseId') warehouseId?: string,
    @Query('locationId') locationId?: string,
    @Query('movementType') movementType?: MovementType,
    @Query('itemId') itemId?: string,
    @Query('referenceType') referenceType?: string,
    @Query('search') search?: string,
  ) {
    const result = await this.stockLedgerService.queueExport({
      userId: req.user?.userId || req.user?.id,
      warehouseId,
      locationId,
      movementType,
      itemId,
      referenceType,
      search,
    });

    return {
      status: true,
      message: "Export queued. You'll receive a notification when your file is ready.",
      data: result,
    };
  }

  @Get('export/:jobId/status')
  @UseGuards(JwtAuthGuard)
  async getStatus(@Param('jobId') jobId: string) {
    const result = await this.stockLedgerService.getJobStatus(jobId);
    return { status: true, data: result };
  }

  @Get('export/:jobId/download')
  async download(@Param('jobId') jobId: string, @Res() res: any) {
    try {
      await this.stockLedgerService.streamExportFile(jobId, res);
    } catch (err: any) {
      const status = err?.status ?? 404;
      res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
    }
  }

  @Get('activity-report')
  @UseGuards(JwtAuthGuard)
  async getActivityReport(
    @Query('locationId') locationId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('summaryOnly') summaryOnly?: string,
    @Query('showBrand') showBrand?: string,
    @Query('showDivision') showDivision?: string,
    @Query('showCategory') showCategory?: string,
    @Query('showGender') showGender?: string,
    @Query('showSilhouette') showSilhouette?: string,
    @Query('showArticle') showArticle?: string,
    @Query('showVariant') showVariant?: string,
  ) {
    const data = await this.stockLedgerService.getStockActivityReport({
      locationId,
      startDate,
      endDate,
      summaryOnly: summaryOnly === 'true',
      showBrand: showBrand !== undefined ? showBrand === 'true' : undefined,
      showDivision: showDivision !== undefined ? showDivision === 'true' : undefined,
      showCategory: showCategory !== undefined ? showCategory === 'true' : undefined,
      showGender: showGender !== undefined ? showGender === 'true' : undefined,
      showSilhouette: showSilhouette !== undefined ? showSilhouette === 'true' : undefined,
      showArticle: showArticle !== undefined ? showArticle === 'true' : undefined,
      showVariant: showVariant !== undefined ? showVariant === 'true' : undefined,
    });
    return { status: true, data };
  }

  @Post('activity-report/export/queue')
  @UseGuards(JwtAuthGuard)
  async queueActivityReportExport(
    @Req() req: any,
    @Body() body: {
      locationId: string;
      startDate?: string;
      endDate?: string;
      format: 'xlsx' | 'pdf';
      summaryOnly?: boolean;
      showBrand?: boolean;
      showDivision?: boolean;
      showCategory?: boolean;
      showGender?: boolean;
      showSilhouette?: boolean;
      showArticle?: boolean;
      showVariant?: boolean;
    },
  ) {
    const userId = req.user?.id;
    const result = await this.stockActivityExportService.queueExport({
      userId,
      locationId: body.locationId,
      startDate: body.startDate,
      endDate: body.endDate,
      format: body.format,
      summaryOnly: body.summaryOnly,
      showBrand: body.showBrand,
      showDivision: body.showDivision,
      showCategory: body.showCategory,
      showGender: body.showGender,
      showSilhouette: body.showSilhouette,
      showArticle: body.showArticle,
      showVariant: body.showVariant,
    });
    return { status: true, data: result };
  }

  @Get('activity-report/export/:jobId/status')
  @UseGuards(JwtAuthGuard)
  async getActivityReportStatus(@Param('jobId') jobId: string) {
    const result = await this.stockActivityExportService.getJobStatus(jobId);
    return { status: true, data: result };
  }

  @Get('activity-report/export/:jobId/download')
  async downloadActivityReportExport(@Param('jobId') jobId: string, @Res() res: any) {
    try {
      await this.stockActivityExportService.streamExportFile(jobId, res);
    } catch (err: any) {
      const status = err?.status ?? 404;
      res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
    }
  }

  @Get('valuation-report')
  @UseGuards(JwtAuthGuard)
  async getValuationReport(
    @Query('locationId') locationId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('summaryOnly') summaryOnly?: string,
    @Query('showBrand') showBrand?: string,
    @Query('showDivision') showDivision?: string,
    @Query('showCategory') showCategory?: string,
    @Query('showGender') showGender?: string,
    @Query('showSilhouette') showSilhouette?: string,
    @Query('showArticle') showArticle?: string,
    @Query('showVariant') showVariant?: string,
  ) {
    const data = await this.stockValuationExportService.getValuationReportData({
      locationId,
      startDate,
      endDate,
      summaryOnly: summaryOnly === 'true',
      showBrand: showBrand !== undefined ? showBrand === 'true' : undefined,
      showDivision: showDivision !== undefined ? showDivision === 'true' : undefined,
      showCategory: showCategory !== undefined ? showCategory === 'true' : undefined,
      showGender: showGender !== undefined ? showGender === 'true' : undefined,
      showSilhouette: showSilhouette !== undefined ? showSilhouette === 'true' : undefined,
      showArticle: showArticle !== undefined ? showArticle === 'true' : undefined,
      showVariant: showVariant !== undefined ? showVariant === 'true' : undefined,
    });
    return { status: true, data };
  }

  @Post('valuation-report/export/queue')
  @UseGuards(JwtAuthGuard)
  async queueValuationReportExport(
    @Req() req: any,
    @Body() body: {
      locationId: string;
      startDate?: string;
      endDate?: string;
      format: 'xlsx' | 'pdf';
      summaryOnly?: boolean;
      showBrand?: boolean;
      showDivision?: boolean;
      showCategory?: boolean;
      showGender?: boolean;
      showSilhouette?: boolean;
      showArticle?: boolean;
      showVariant?: boolean;
    },
  ) {
    const userId = req.user?.id;
    const result = await this.stockValuationExportService.queueExport({
      userId,
      locationId: body.locationId,
      startDate: body.startDate,
      endDate: body.endDate,
      format: body.format,
      summaryOnly: body.summaryOnly,
      showBrand: body.showBrand,
      showDivision: body.showDivision,
      showCategory: body.showCategory,
      showGender: body.showGender,
      showSilhouette: body.showSilhouette,
      showArticle: body.showArticle,
      showVariant: body.showVariant,
    });
    return { status: true, data: result };
  }

  @Get('valuation-report/export/:jobId/status')
  @UseGuards(JwtAuthGuard)
  async getValuationReportStatus(@Param('jobId') jobId: string) {
    const result = await this.stockValuationExportService.getJobStatus(jobId);
    return { status: true, data: result };
  }

  @Get('valuation-report/export/:jobId/download')
  async downloadValuationReportExport(@Param('jobId') jobId: string, @Res() res: any) {
    try {
      await this.stockValuationExportService.streamExportFile(jobId, res);
    } catch (err: any) {
      const status = err?.status ?? 404;
      res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
    }
  }
}
