import { Controller, Get, Post, Query, Param, Req, Res, UseGuards, Body, Sse, MessageEvent, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Observable, interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { StockLedgerService } from './stock-ledger.service';
import { StockActivityExportService } from './stock-activity-export.service';
import { StockValuationExportService } from './stock-valuation-export.service';
import { StockTransactionDetailExportService } from './stock-transaction-detail-export.service';
import { AvailableStockSummaryExportService } from './available-stock-summary-export.service';
import { OverallAvailableReservedStockExportService } from './overall-available-reserved-stock-export.service';
import { InventoryAgingExportService } from './inventory-aging-export.service';
import { MovementType } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { FiscalYearClosingService } from './fiscal-year-closing.service';

@Controller('api/stock-ledger')
export class StockLedgerController {
  constructor(
    private readonly stockLedgerService: StockLedgerService,
    private readonly stockActivityExportService: StockActivityExportService,
    private readonly stockValuationExportService: StockValuationExportService,
    private readonly stockTransactionDetailExportService: StockTransactionDetailExportService,
    private readonly availableStockSummaryExportService: AvailableStockSummaryExportService,
    private readonly overallAvailableReservedStockExportService: OverallAvailableReservedStockExportService,
    private readonly inventoryAgingExportService: InventoryAgingExportService,
    private readonly fiscalClosingService: FiscalYearClosingService,
  ) { }

  @Get('levels')
  async getStockLevels(@Query('warehouseId') warehouseId?: string, @Query('locationId') locationId?: string) {
    return this.stockLedgerService.getStockLevels({ warehouseId, locationId });
  }

  @Post('sync-sales-history')
  @UseGuards(JwtAuthGuard)
  async syncSalesHistory(
    @Query('locationId') locationId?: string,
  ) {
    const result = await this.stockLedgerService.syncAllSalesAndReturnsToStockLedger({ locationId });
    return {
      status: true,
      message: 'Stock ledger and inventory sync completed successfully',
      data: result,
    };
  }

  @Get()
  async findAll(
    @Query('warehouseId') warehouseId?: string,
    @Query('locationId') locationId?: string,
    @Query('movementType') movementType?: MovementType,
    @Query('itemId') itemId?: string,
    @Query('referenceType') referenceType?: string,
    @Query('cursor') cursor?: string,   // BigInt id of last seen record
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.stockLedgerService.findAll({
      warehouseId,
      locationId,
      movementType,
      itemId,
      referenceType,
      cursor: cursor ? BigInt(cursor) : undefined,
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
    @Query('locationId') locationId?: string,
    @Query('warehouseId') warehouseId?: string,
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
      warehouseId,
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
      locationId?: string;
      warehouseId?: string;
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
    const userId = req.user?.id || req.user?.userId;
    const result = await this.stockActivityExportService.queueExport({
      userId,
      locationId: body.locationId,
      warehouseId: body.warehouseId,
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
    }
  }

  // ─── Stock Activity PRO ERP Preview & SSE Endpoints ──────────────────────
  @Post('reports/stock-activity/queue')
  @UseGuards(JwtAuthGuard)
  async queueStockActivityPreview(
    @Req() req: any,
    @Body() body: {
      locationId?: string;
      warehouseId?: string;
      startDate?: string;
      endDate?: string;
      reportType?: 'merged' | 'separate';
      search?: string;
    },
  ) {
    const userId = req.user?.id || req.user?.userId;
    const result = await this.stockActivityExportService.queueReportPreview({
      userId,
      ...body,
    });
    return { status: true, data: result };
  }

  @Sse('reports/stock-activity/stream/:jobId')
  streamStockActivityStatus(@Param('jobId') jobId: string): Observable<MessageEvent> {
    return interval(1000).pipe(
      switchMap(async () => {
        const queueStatus = await this.stockActivityExportService.getJobQueueStatus(jobId);
        return {
          data: JSON.stringify({
            status: queueStatus.status || queueStatus.state,
            state: queueStatus.state,
            progress: queueStatus.progress,
            message: queueStatus.message,
            queuePosition: queueStatus.queuePosition,
            waitingCount: queueStatus.waitingCount,
            failedReason: queueStatus.failedReason,
          }),
        } as MessageEvent;
      }),
    );
  }

  @Get('reports/stock-activity/result/:jobId')
  @UseGuards(JwtAuthGuard)
  async getStockActivityResult(@Param('jobId') jobId: string) {
    const data = await this.stockActivityExportService.getReportPreviewResult(jobId);
    if (!data) {
      return { status: false, message: 'Stock Activity report result not found or expired' };
    }
    return { status: true, data };
  }

  @Post('reports/stock-activity/export/register-client-export')
  @UseGuards(JwtAuthGuard)
  async registerClientStockActivityExport(
    @Req() req: any,
    @Body() body: {
      fileName: string;
      fileBase64: string;
      mimeType: string;
    },
  ) {
    const userId = req.user?.id || req.user?.userId;
    const result = await this.stockActivityExportService.registerClientGeneratedExport(
      req.prisma || (this.stockLedgerService as any).prisma,
      userId,
      body,
    );
    return { status: true, data: result };
  }

  @Get('valuation-report')
  @UseGuards(JwtAuthGuard)
  async getValuationReport(
    @Query('locationId') locationId?: string,
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
    const resData = await this.stockValuationExportService.getValuationReportData({
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
    return { status: true, ...resData };
  }

  @Post('valuation-report/export/queue')
  @UseGuards(JwtAuthGuard)
  async queueValuationReportExport(
    @Req() req: any,
    @Body() body: {
      locationId?: string;
      startDate?: string;
      endDate?: string;
      format: 'xlsx' | 'pdf';
      exportType?: 'hierarchical' | 'flat';
      filterBrands?: string[];
      filterDivisions?: string[];
      filterCategories?: string[];
      filterGenders?: string[];
      filterSilhouettes?: string[];
      searchText?: string;
      summaryOnly?: boolean;
      showBrand?: boolean;
      showDivision?: boolean;
      showCategory?: boolean;
      showGender?: boolean;
      showSilhouette?: boolean;
      showArticle?: boolean;
      showVariant?: boolean;
      previewJobId?: string;
    },
  ) {
    const userId = req.user?.id || req.user?.userId;
    const result = await this.stockValuationExportService.queueExport({
      userId,
      ...body,
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

  @Get('transaction-detail-report')
  @UseGuards(JwtAuthGuard)
  async getTransactionDetailReport(
    @Query('locationId') locationId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('itemId') itemId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
    @Query('showBrand') showBrand?: string,
    @Query('showDivision') showDivision?: string,
    @Query('showCategory') showCategory?: string,
    @Query('showGender') showGender?: string,
    @Query('showSilhouette') showSilhouette?: string,
    @Query('showArticle') showArticle?: string,
    @Query('showVariant') showVariant?: string,
  ) {
    const result = await this.stockLedgerService.getStockTransactionDetailReport({
      locationId,
      warehouseId,
      itemId,
      startDate,
      endDate,
      search,
      showBrand: showBrand !== undefined ? showBrand === 'true' : undefined,
      showDivision: showDivision !== undefined ? showDivision === 'true' : undefined,
      showCategory: showCategory !== undefined ? showCategory === 'true' : undefined,
      showGender: showGender !== undefined ? showGender === 'true' : undefined,
      showSilhouette: showSilhouette !== undefined ? showSilhouette === 'true' : undefined,
      showArticle: showArticle !== undefined ? showArticle === 'true' : undefined,
      showVariant: showVariant !== undefined ? showVariant === 'true' : undefined,
    });
    return { status: true, data: result };
  }

  @Post('transaction-detail-report/export/queue')
  @UseGuards(JwtAuthGuard)
  async queueTransactionDetailReportExport(
    @Req() req: any,
    @Body() body: {
      locationId?: string;
      warehouseId?: string;
      itemId?: string;
      startDate?: string;
      endDate?: string;
      format: 'xlsx' | 'pdf';
      search?: string;
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
    const userId = req.user?.id || req.user?.userId;
    const result = await this.stockTransactionDetailExportService.queueExport({
      userId,
      locationId: body.locationId,
      warehouseId: body.warehouseId,
      itemId: body.itemId,
      startDate: body.startDate,
      endDate: body.endDate,
      format: body.format,
      search: body.search,
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

  @Get('transaction-detail-report/export/:jobId/status')
  @UseGuards(JwtAuthGuard)
  async getTransactionDetailReportStatus(@Param('jobId') jobId: string) {
    const result = await this.stockTransactionDetailExportService.getJobStatus(jobId);
    return { status: true, data: result };
  }

  @Get('transaction-detail-report/export/:jobId/download')
  async downloadTransactionDetailReportExport(@Param('jobId') jobId: string, @Res() res: any) {
    try {
      await this.stockTransactionDetailExportService.streamExportFile(jobId, res);
    } catch (err: any) {
      const status = err?.status ?? 404;
      res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
    }
  }

  @Get('available-stock-summary')
  @UseGuards(JwtAuthGuard)
  async getAvailableStockSummaryReport(
    @Query('locationId') locationId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('reportType') reportType?: 'merged' | 'separate',
    @Query('summaryOnly') summaryOnly?: string,
    @Query('showBrand') showBrand?: string,
    @Query('showDivision') showDivision?: string,
    @Query('showCategory') showCategory?: string,
    @Query('showGender') showGender?: string,
    @Query('showSilhouette') showSilhouette?: string,
    @Query('showArticle') showArticle?: string,
    @Query('showVariant') showVariant?: string,
  ) {
    const data = await this.availableStockSummaryExportService.getAvailableStockSummaryReportData({
      locationId,
      warehouseId,
      startDate,
      endDate,
      reportType,
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

  @Post('available-stock-summary/queue')
  @UseGuards(JwtAuthGuard)
  async queueAvailableStockSummaryPreview(
    @Req() req: any,
    @Body() body: {
      locationId?: string;
      warehouseId?: string;
      startDate?: string;
      endDate?: string;
      reportType?: 'merged' | 'separate';
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
    const userId = req.user?.id || req.user?.userId;
    const result = await this.availableStockSummaryExportService.queueReportPreview({
      userId,
      ...body,
    });
    return { status: true, data: result };
  }

  @Sse('available-stock-summary/stream/:jobId')
  streamAvailableStockSummaryReport(@Param('jobId') jobId: string): Observable<MessageEvent> {
    return interval(1000).pipe(
      switchMap(async () => {
        const status = await this.availableStockSummaryExportService.getJobQueueStatus(jobId);
        return {
          data: JSON.stringify({
            jobId,
            status: status.state,
            progress: status.progress,
            message: status.message,
            queuePosition: status.queuePosition,
            waitingCount: status.waitingCount,
            failedReason: status.failedReason,
          }),
        } as MessageEvent;
      }),
    );
  }

  @Get('available-stock-summary/result/:jobId')
  @UseGuards(JwtAuthGuard)
  async getAvailableStockSummaryReportResult(@Param('jobId') jobId: string) {
    const data = this.availableStockSummaryExportService.getReportPreviewResult(jobId);
    if (!data) {
      return { status: false, message: 'Report result not ready or expired' };
    }
    return { status: true, data };
  }

  @Post('available-stock-summary/export/queue')
  @UseGuards(JwtAuthGuard)
  async queueAvailableStockSummaryExport(
    @Req() req: any,
    @Body() body: {
      locationId?: string;
      warehouseId?: string;
      startDate?: string;
      endDate?: string;
      format: 'xlsx' | 'pdf';
      exportType?: 'hierarchical' | 'flat';
      reportType?: 'merged' | 'separate';
      summaryOnly?: boolean;
      showBrand?: boolean;
      showDivision?: boolean;
      showCategory?: boolean;
      showGender?: boolean;
      showSilhouette?: boolean;
      showArticle?: boolean;
      showVariant?: boolean;
      includeCosting?: boolean;
      previewJobId?: string;
    },
  ) {
    const userId = req.user?.id || req.user?.userId;
    const result = await this.availableStockSummaryExportService.queueExport({
      userId,
      ...body,
    });
    return { status: true, data: result };
  }

  @Post('available-stock-summary/export/register-client-export')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async registerClientGeneratedExport(
    @Req() req: any,
    @UploadedFile() file: any,
    @Body() body: { fileName?: string; format?: 'xlsx' | 'pdf' },
  ) {
    const userId = req.user?.id || req.user?.userId;
    if (!file || !file.buffer) {
      throw new BadRequestException('No file uploaded');
    }
    const result = await this.availableStockSummaryExportService.registerClientGeneratedExport({
      userId,
      fileBuffer: file.buffer,
      fileName: body.fileName || `available-stock-summary-${new Date().toISOString().slice(0, 10)}.${body.format || 'xlsx'}`,
      format: body.format || 'xlsx',
    });
    return { status: true, data: result };
  }

  @Post('valuation-report/queue')
  @UseGuards(JwtAuthGuard)
  async queueValuationReportPreview(
    @Req() req: any,
    @Body() body: {
      locationId?: string;
      startDate?: string;
      endDate?: string;
      summaryOnly?: boolean;
      showBrand?: boolean;
      showDivision?: boolean;
      showCategory?: boolean;
      showGender?: boolean;
      showSilhouette?: boolean;
      showArticle?: boolean;
      showVariant?: boolean;
      filterBrands?: string[];
      filterDivisions?: string[];
      filterCategories?: string[];
      filterGenders?: string[];
      filterSilhouettes?: string[];
      searchText?: string;
    },
  ) {
    const userId = req.user?.id || req.user?.userId;
    const result = await this.stockValuationExportService.queueReportPreview({
      userId,
      ...body,
    });
    return { status: true, data: result };
  }

  @Sse('valuation-report/stream/:jobId')
  streamValuationReport(@Param('jobId') jobId: string): Observable<MessageEvent> {
    return interval(1000).pipe(
      switchMap(async () => {
        const status = await this.stockValuationExportService.getJobQueueStatus(jobId);
        return {
          data: JSON.stringify({
            jobId,
            status: status.state,
            progress: status.progress,
            message: status.message,
            queuePosition: status.queuePosition,
            waitingCount: status.waitingCount,
            failedReason: status.failedReason,
          }),
        } as MessageEvent;
      }),
    );
  }

  @Get('valuation-report/result/:jobId')
  @UseGuards(JwtAuthGuard)
  async getValuationReportResult(@Param('jobId') jobId: string) {
    const data = this.stockValuationExportService.getReportPreviewResult(jobId);
    if (!data) {
      return { status: false, message: 'Report result not ready or expired' };
    }
    return { status: true, data };
  }

  @Get('available-stock-summary/export/:jobId/status')
  @UseGuards(JwtAuthGuard)
  async getAvailableStockSummaryStatus(@Param('jobId') jobId: string) {
    const result = await this.availableStockSummaryExportService.getJobStatus(jobId);
    return { status: true, data: result };
  }

  @Get('available-stock-summary/export/:jobId/download')
  async downloadAvailableStockSummaryExport(@Param('jobId') jobId: string, @Res() res: any) {
    try {
      await this.availableStockSummaryExportService.streamExportFile(jobId, res);
    } catch (err: any) {
      const status = err?.status ?? 404;
      res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
    }
  }

  @Get('overall-available-reserved-stock')
  @UseGuards(JwtAuthGuard)
  async getOverallAvailableReservedStockReport(
    @Query('locationId') locationId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('asOfDate') asOfDate?: string,
    @Query('summaryOnly') summaryOnly?: string,
    @Query('showBrand') showBrand?: string,
    @Query('showDivision') showDivision?: string,
    @Query('showCategory') showCategory?: string,
    @Query('showGender') showGender?: string,
    @Query('showSilhouette') showSilhouette?: string,
    @Query('showArticle') showArticle?: string,
    @Query('showVariant') showVariant?: string,
    @Query('includeCosting') includeCosting?: string,
  ) {
    const data = await this.overallAvailableReservedStockExportService.getOverallAvailableReservedStockReportData({
      locationId,
      warehouseId,
      asOfDate,
      summaryOnly: summaryOnly === 'true',
      showBrand: showBrand !== undefined ? showBrand === 'true' : undefined,
      showDivision: showDivision !== undefined ? showDivision === 'true' : undefined,
      showCategory: showCategory !== undefined ? showCategory === 'true' : undefined,
      showGender: showGender !== undefined ? showGender === 'true' : undefined,
      showSilhouette: showSilhouette !== undefined ? showSilhouette === 'true' : undefined,
      showArticle: showArticle !== undefined ? showArticle === 'true' : undefined,
      showVariant: showVariant !== undefined ? showVariant === 'true' : undefined,
      includeCosting: includeCosting === 'true',
    });
    return { status: true, data };
  }

  @Post('overall-available-reserved-stock/queue')
  @UseGuards(JwtAuthGuard)
  async queueOverallAvailableReservedStockPreview(
    @Req() req: any,
    @Body() body: {
      locationId?: string;
      warehouseId?: string;
      asOfDate?: string;
      summaryOnly?: boolean;
      showBrand?: boolean;
      showDivision?: boolean;
      showCategory?: boolean;
      showGender?: boolean;
      showSilhouette?: boolean;
      showArticle?: boolean;
      showVariant?: boolean;
      includeCosting?: boolean;
    },
  ) {
    const userId = req.user?.id || req.user?.userId;
    const result = await this.overallAvailableReservedStockExportService.queueReportPreview({
      userId,
      ...body,
    });
    return { status: true, data: result };
  }

  @Sse('overall-available-reserved-stock/stream/:jobId')
  streamOverallAvailableReservedStockReport(@Param('jobId') jobId: string): Observable<MessageEvent> {
    return interval(1000).pipe(
      switchMap(async () => {
        const status = await this.overallAvailableReservedStockExportService.getJobQueueStatus(jobId);
        return {
          data: JSON.stringify({
            jobId,
            status: status.state,
            progress: status.progress,
            message: status.message,
            queuePosition: status.queuePosition,
            waitingCount: status.waitingCount,
            failedReason: status.failedReason,
          }),
        } as MessageEvent;
      }),
    );
  }

  @Get('overall-available-reserved-stock/result/:jobId')
  @UseGuards(JwtAuthGuard)
  async getOverallAvailableReservedStockReportResult(@Param('jobId') jobId: string) {
    const data = this.overallAvailableReservedStockExportService.getReportPreviewResult(jobId);
    if (!data) {
      return { status: false, message: 'Report result not ready or expired' };
    }
    return { status: true, data };
  }

  @Post('overall-available-reserved-stock/cancel-preview/:jobId')
  @UseGuards(JwtAuthGuard)
  async cancelOverallAvailableReservedStockPreview(@Param('jobId') jobId: string) {
    this.overallAvailableReservedStockExportService.cancelReportPreview(jobId);
    return { status: true, message: 'Preview job cancelled' };
  }

  @Post('overall-available-reserved-stock/export/queue')
  @UseGuards(JwtAuthGuard)
  async queueOverallAvailableReservedStockExport(
    @Req() req: any,
    @Body() body: {
      locationId?: string;
      warehouseId?: string;
      asOfDate?: string;
      format: 'xlsx' | 'pdf';
      summaryOnly?: boolean;
      showBrand?: boolean;
      showDivision?: boolean;
      showCategory?: boolean;
      showGender?: boolean;
      showSilhouette?: boolean;
      showArticle?: boolean;
      showVariant?: boolean;
      includeCosting?: boolean;
      previewJobId?: string;
    },
  ) {
    const userId = req.user?.id || req.user?.userId;
    const result = await this.overallAvailableReservedStockExportService.queueExport({
      userId,
      locationId: body.locationId,
      warehouseId: body.warehouseId,
      asOfDate: body.asOfDate,
      format: body.format,
      summaryOnly: body.summaryOnly,
      showBrand: body.showBrand,
      showDivision: body.showDivision,
      showCategory: body.showCategory,
      showGender: body.showGender,
      showSilhouette: body.showSilhouette,
      showArticle: body.showArticle,
      showVariant: body.showVariant,
      includeCosting: body.includeCosting,
      previewJobId: body.previewJobId,
    });
    return { status: true, data: result };
  }

  @Get('overall-available-reserved-stock/export/:jobId/status')
  @UseGuards(JwtAuthGuard)
  async getOverallAvailableReservedStockStatus(@Param('jobId') jobId: string) {
    const result = await this.overallAvailableReservedStockExportService.getJobStatus(jobId);
    return { status: true, data: result };
  }

  @Get('overall-available-reserved-stock/export/:jobId/download')
  async downloadOverallAvailableReservedStockExport(@Param('jobId') jobId: string, @Res() res: any) {
    try {
      await this.overallAvailableReservedStockExportService.streamExportFile(jobId, res);
    } catch (err: any) {
      const status = err?.status ?? 404;
      res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
    }
  }

  @Post('overall-available-reserved-stock/export/register-client-export')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async registerOverallAvailableReservedStockClientExport(
    @UploadedFile() file: any,
    @Body('fileName') fileName: string,
    @Body('format') formatStr: string,
    @Req() req: any,
  ) {
    if (!file) {
      return { status: false, message: 'No file uploaded' };
    }
    const userId = req.user?.id || req.user?.userId;
    const result = await this.overallAvailableReservedStockExportService.registerClientGeneratedExport({
      userId,
      fileBuffer: file.buffer,
      fileName,
      format: formatStr === 'pdf' ? 'pdf' : (formatStr === 'html' ? 'html' : 'xlsx'),
    });
    return { status: true, data: result };
  }

  // ─── Stock Transaction Detail Report SSE & Export Endpoints ────────────────

  @Post('stock-transaction-detail/queue')
  @UseGuards(JwtAuthGuard)
  async queueStockTransactionDetailPreview(
    @Req() req: any,
    @Body() body: {
      locationId?: string;
      warehouseId?: string;
      itemId?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
      showBrand?: boolean;
      showDivision?: boolean;
      showCategory?: boolean;
      showGender?: boolean;
      showSilhouette?: boolean;
      showArticle?: boolean;
      showVariant?: boolean;
    },
  ) {
    const userId = req.user?.id || req.user?.userId;
    const result = await this.stockTransactionDetailExportService.queueReportPreview({
      userId,
      ...body,
    });
    return { status: true, data: result };
  }

  @Sse('stock-transaction-detail/stream/:jobId')
  streamStockTransactionDetailReport(@Param('jobId') jobId: string): Observable<MessageEvent> {
    return interval(1000).pipe(
      switchMap(async () => {
        const status = await this.stockTransactionDetailExportService.getJobQueueStatus(jobId);
        return {
          data: JSON.stringify({
            jobId,
            status: status.state,
            progress: status.progress,
            message: status.message,
            queuePosition: status.queuePosition,
            waitingCount: status.waitingCount,
            failedReason: status.failedReason,
          }),
        } as MessageEvent;
      }),
    );
  }

  @Get('stock-transaction-detail/result/:jobId')
  @UseGuards(JwtAuthGuard)
  async getStockTransactionDetailReportResult(@Param('jobId') jobId: string) {
    const data = this.stockTransactionDetailExportService.getReportPreviewResult(jobId);
    if (!data) {
      return { status: false, message: 'Report result not ready or expired' };
    }
    return { status: true, data };
  }

  @Post('stock-transaction-detail/cancel-preview/:jobId')
  @UseGuards(JwtAuthGuard)
  async cancelStockTransactionDetailPreview(@Param('jobId') jobId: string) {
    this.stockTransactionDetailExportService.cancelReportPreview(jobId);
    return { status: true, message: 'Preview job cancelled' };
  }

  @Post('stock-transaction-detail/export/register-client-export')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async registerStockTransactionDetailClientExport(
    @UploadedFile() file: any,
    @Body('fileName') fileName: string,
    @Body('format') formatStr: string,
    @Req() req: any,
  ) {
    if (!file) {
      return { status: false, message: 'No file uploaded' };
    }
    const userId = req.user?.id || req.user?.userId;
    const result = await this.stockTransactionDetailExportService.registerClientGeneratedExport({
      userId,
      fileBuffer: file.buffer,
      fileName,
      format: formatStr === 'pdf' ? 'pdf' : (formatStr === 'html' ? 'html' : 'xlsx'),
    });
    return { status: true, data: result };
  }

  // ─── Inventory Aging Report SSE & Export Endpoints ─────────────────────────

  @Post('inventory-aging/queue')
  @UseGuards(JwtAuthGuard)
  async queueInventoryAgingPreview(
    @Req() req: any,
    @Body() body: {
      locationId?: string;
      warehouseId?: string;
      startDate?: string;
      endDate?: string;
      reportType?: 'merged' | 'separate';
    },
  ) {
    const userId = req.user?.id || req.user?.userId;
    const result = await this.inventoryAgingExportService.queueReportPreview({
      userId,
      ...body,
    });
    return { status: true, data: result };
  }

  @Sse('inventory-aging/stream/:jobId')
  streamInventoryAgingReport(@Param('jobId') jobId: string): Observable<MessageEvent> {
    return interval(1000).pipe(
      switchMap(async () => {
        const status = await this.inventoryAgingExportService.getJobQueueStatus(jobId);
        return {
          data: JSON.stringify({
            jobId,
            status: status.state,
            progress: status.progress,
            message: status.message,
            queuePosition: status.queuePosition,
            waitingCount: status.waitingCount,
            failedReason: status.failedReason,
          }),
        } as MessageEvent;
      }),
    );
  }

  @Get('inventory-aging/result/:jobId')
  @UseGuards(JwtAuthGuard)
  async getInventoryAgingReportResult(@Param('jobId') jobId: string) {
    const res = await this.inventoryAgingExportService.getPreviewResult(jobId);
    return res;
  }

  @Post('inventory-aging/export/register-client-export')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async registerInventoryAgingClientExport(
    @UploadedFile() file: any,
    @Body('fileName') fileName: string,
    @Body('format') formatStr: string,
    @Req() req: any,
  ) {
    if (!file) {
      return { status: false, message: 'No file uploaded' };
    }
    const userId = req.user?.id || req.user?.userId;
    const result = await this.inventoryAgingExportService.registerClientGeneratedExport({
      userId,
      fileBuffer: file.buffer,
      fileName,
      format: formatStr === 'pdf' ? 'pdf' : 'xlsx',
    });
    return { status: true, data: result };
  }

  @Post('fiscal-year-close/execute')
  @UseGuards(JwtAuthGuard)
  async executeFiscalYearClose(
    @Req() req: any,
    @Body() body: { fiscalYearName?: string; closingDate?: string; skipLedgerEntries?: boolean },
  ) {
    const userId = req.user?.id || req.user?.userId;
    const now = new Date();
    const prevYear = now.getFullYear() - 1;
    const closingYear = now.getFullYear();
    const fiscalYearName = body.fiscalYearName || `FY_${prevYear}_${closingYear}`;
    const closingDate = body.closingDate ? new Date(body.closingDate) : new Date(closingYear, 5, 30, 23, 59, 59);

    const result = await this.fiscalClosingService.executeYearEndClose(req.prisma || this.stockLedgerService.getPrismaClient(), {
      fiscalYearName,
      closingDate,
      userId,
      skipLedgerEntries: !!body.skipLedgerEntries,
    });
    return { status: true, data: result };
  }

  @Get('fiscal-year-close/latest-snapshot')
  @UseGuards(JwtAuthGuard)
  async getLatestFiscalSnapshot(@Req() req: any) {
    const snapshotDate = await this.fiscalClosingService.findLatestFiscalOpeningSnapshotDate(req.prisma || this.stockLedgerService.getPrismaClient());
    return { status: true, data: { snapshotDate } };
  }

  @Post('fiscal-year-close/backfill')
  @UseGuards(JwtAuthGuard)
  async backfillFiscalSnapshot(@Req() req: any) {
    const userId = req.user?.id || req.user?.userId;
    const result = await this.fiscalClosingService.backfillInitialFiscalPeriod(req.prisma || this.stockLedgerService.getPrismaClient(), userId);
    return { status: true, data: result };
  }

  @Post('fiscal-year-close/adjust-opening-balances')
  @UseGuards(JwtAuthGuard)
  async adjustOpeningBalances(
    @Req() req: any,
    @Body() body: {
      warehouseCode?: string;
      warehouseId?: string;
      adjustments: Array<{
        barCode: string;
        deductQty: number;
        newUnitCost: number;
      }>;
    },
  ) {
    const result = await this.fiscalClosingService.adjustOpeningBalances(
      req.prisma || this.stockLedgerService.getPrismaClient(),
      body,
    );
    return { status: true, data: result };
  }
}
