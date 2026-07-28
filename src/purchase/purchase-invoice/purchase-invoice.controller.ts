import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  Req,
} from '@nestjs/common';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { PiRegisterExportService } from './pi-register-export.service';
import { CreatePurchaseInvoiceDto, UpdatePurchaseInvoiceDto } from './dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { Res } from '@nestjs/common';

@ApiTags('Purchase Invoice')
@Controller('api/purchase/purchase-invoices')
@UseGuards(JwtAuthGuard)
export class PurchaseInvoiceController {
  constructor(
    private readonly purchaseInvoiceService: PurchaseInvoiceService,
    private readonly piRegisterExportService: PiRegisterExportService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new purchase invoice' })
  @ApiResponse({ status: 201, description: 'Purchase invoice created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - validation failed' })
  create(@Body() createPurchaseInvoiceDto: CreatePurchaseInvoiceDto, @Req() req: any) {
    return this.purchaseInvoiceService.create(createPurchaseInvoiceDto, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @ApiOperation({ summary: 'Get all purchase invoices with pagination and filtering' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'supplierId', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'CANCELLED'] })
  @ApiQuery({ name: 'paymentStatus', required: false, enum: ['UNPAID', 'PARTIAL', 'PAID'] })
  @ApiQuery({ name: 'invoiceType', required: false, enum: ['GRN_BASED', 'LANDED_COST_BASED', 'DIRECT'] })
  @ApiQuery({ name: 'search', required: false, type: String })
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit?: number,
    @Query('supplierId') supplierId?: string,
    @Query('status') status?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('invoiceType') invoiceType?: string,
    @Query('search') search?: string,
  ) {
    return this.purchaseInvoiceService.findAll(page, limit, {
      supplierId,
      status,
      paymentStatus,
      invoiceType,
      search,
    });
  }

  @Get('next-invoice-number')
  @ApiOperation({ summary: 'Get next available invoice number' })
  getNextInvoiceNumber() {
    return this.purchaseInvoiceService.getNextInvoiceNumber();
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get purchase invoice summary statistics' })
  @ApiQuery({ name: 'supplierId', required: false, type: String })
  getSummary(@Query('supplierId') supplierId?: string) {
    return this.purchaseInvoiceService.getSummary(supplierId);
  }

  @Get('valued-grns')
  @ApiOperation({ summary: 'Get valued GRNs available for invoicing' })
  getValuedGrns() {
    return this.purchaseInvoiceService.getValuedGrns();
  }

  @Get('available-landed-costs')
  @ApiOperation({ summary: 'Get available landed costs for invoicing' })
  getAvailableLandedCosts() {
    return this.purchaseInvoiceService.getAvailableLandedCosts();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get purchase invoice by ID' })
  @ApiResponse({ status: 200, description: 'Purchase invoice found' })
  @ApiResponse({ status: 404, description: 'Purchase invoice not found' })
  findOne(@Param('id') id: string) {
    return this.purchaseInvoiceService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update purchase invoice' })
  @ApiResponse({ status: 200, description: 'Purchase invoice updated successfully' })
  @ApiResponse({ status: 404, description: 'Purchase invoice not found' })
  update(
    @Param('id') id: string,
    @Body() updatePurchaseInvoiceDto: UpdatePurchaseInvoiceDto,
    @Req() req: any
  ) {
    return this.purchaseInvoiceService.update(id, updatePurchaseInvoiceDto, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve purchase invoice' })
  @ApiResponse({ status: 200, description: 'Invoice approved successfully' })
  approve(@Param('id') id: string, @Req() req: any) {
    return this.purchaseInvoiceService.approve(id, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel purchase invoice' })
  @ApiResponse({ status: 200, description: 'Invoice cancelled successfully' })
  cancel(@Param('id') id: string, @Body() cancelDto: { reason?: string }, @Req() req: any) {
    return this.purchaseInvoiceService.cancel(id, cancelDto.reason, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete purchase invoice' })
  @ApiResponse({ status: 200, description: 'Purchase invoice deleted successfully' })
  @ApiResponse({ status: 404, description: 'Purchase invoice not found' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.purchaseInvoiceService.remove(id, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('register-report/data')
  @ApiOperation({ summary: 'Get Purchase Invoice Register Report data' })
  getRegisterReportData(
    @Query('brandId') brandId?: string,
    @Query('supplierId') supplierId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('invoiceType') invoiceType?: string,
    @Query('search') search?: string,
  ) {
    return this.piRegisterExportService.getReportData({
      brandId,
      supplierId,
      startDate,
      endDate,
      status,
      paymentStatus,
      invoiceType,
      search,
    });
  }

  @Post('register-report/export')
  @ApiOperation({ summary: 'Queue Purchase Invoice Register Report background export' })
  queueRegisterReportExport(
    @Body()
    body: {
      brandId?: string;
      supplierId?: string;
      startDate?: string;
      endDate?: string;
      status?: string;
      paymentStatus?: string;
      invoiceType?: string;
      format: 'xlsx' | 'pdf';
      search?: string;
    },
    @Req() req: any,
  ) {
    return this.piRegisterExportService.queueExport({
      userId: req.user?.id || 'system',
      brandId: body.brandId,
      supplierId: body.supplierId,
      startDate: body.startDate,
      endDate: body.endDate,
      status: body.status,
      paymentStatus: body.paymentStatus,
      invoiceType: body.invoiceType,
      format: body.format || 'xlsx',
      search: body.search,
    });
  }

  @Get('register-report/export/:jobId/status')
  @ApiOperation({ summary: 'Get status of queued Purchase Invoice Register export' })
  getRegisterExportStatus(@Param('jobId') jobId: string) {
    return this.piRegisterExportService.getJobStatus(jobId);
  }

  @Get('register-report/export/:jobId/download')
  @ApiOperation({ summary: 'Download completed Purchase Invoice Register export file' })
  downloadRegisterExport(@Param('jobId') jobId: string, @Res() res: any) {
    return this.piRegisterExportService.streamExportFile(jobId, res);
  }
}