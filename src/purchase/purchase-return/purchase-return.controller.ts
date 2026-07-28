import { Controller, Get, Post, Body, Patch, Param, Delete, Query, Req, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PurchaseReturnService } from './purchase-return.service';
import { PurchaseReturnRegisterExportService } from './purchase-return-register-export.service';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto';
import { UpdatePurchaseReturnDto } from './dto/update-purchase-return.dto';

@ApiTags('purchase-returns')
@Controller('api/purchase/purchase-returns')
export class PurchaseReturnController {
  constructor(
    private readonly purchaseReturnService: PurchaseReturnService,
    private readonly purchaseReturnRegisterExportService: PurchaseReturnRegisterExportService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new purchase return' })
  @ApiResponse({ status: 201, description: 'Purchase return created successfully' })
  create(@Body() createDto: CreatePurchaseReturnDto, @Req() req: any) {
    return this.purchaseReturnService.create(createDto, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @ApiOperation({ summary: 'Get all purchase returns' })
  @ApiResponse({ status: 200, description: 'List of purchase returns' })
  findAll(@Query('status') status?: string) {
    return this.purchaseReturnService.findAll(status);
  }

  @Get('eligible-grns')
  @ApiOperation({ summary: 'Get eligible GRNs for return' })
  @ApiResponse({ status: 200, description: 'List of eligible GRNs' })
  getEligibleGrns() {
    return this.purchaseReturnService.getEligibleGrns();
  }

  @Get('eligible-landed-costs')
  @ApiOperation({ summary: 'Get eligible landed costs for return' })
  @ApiResponse({ status: 200, description: 'List of eligible landed costs' })
  getEligibleLandedCosts() {
    return this.purchaseReturnService.getEligibleLandedCosts();
  }

  @Get('eligible-invoices')
  @ApiOperation({ summary: 'Get eligible purchase invoices for return' })
  @ApiResponse({ status: 200, description: 'List of eligible purchase invoices' })
  getEligibleInvoices() {
    return this.purchaseReturnService.getEligibleInvoices();
  }

  @Get('next-return-number')
  @ApiOperation({ summary: 'Get next available return number' })
  @ApiResponse({ status: 200, description: 'Next return number' })
  getNextReturnNumber() {
    return this.purchaseReturnService.getNextReturnNumber();
  }

  @Get('register-report/data')
  @ApiOperation({ summary: 'Get Purchase Return Register Report data' })
  getRegisterReportData(
    @Query('brandId') brandId?: string,
    @Query('supplierId') supplierId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
    @Query('returnType') returnType?: string,
    @Query('sourceType') sourceType?: string,
    @Query('search') search?: string,
  ) {
    return this.purchaseReturnRegisterExportService.getReportData({
      brandId,
      supplierId,
      startDate,
      endDate,
      status,
      returnType,
      sourceType,
      search,
    });
  }

  @Post('register-report/export')
  @ApiOperation({ summary: 'Queue Purchase Return Register Report background export' })
  queueRegisterReportExport(
    @Body()
    body: {
      brandId?: string;
      supplierId?: string;
      startDate?: string;
      endDate?: string;
      status?: string;
      returnType?: string;
      sourceType?: string;
      format: 'xlsx' | 'pdf';
      search?: string;
    },
    @Req() req: any,
  ) {
    return this.purchaseReturnRegisterExportService.queueExport({
      userId: req.user?.id || 'system',
      brandId: body.brandId,
      supplierId: body.supplierId,
      startDate: body.startDate,
      endDate: body.endDate,
      status: body.status,
      returnType: body.returnType,
      sourceType: body.sourceType,
      format: body.format || 'xlsx',
      search: body.search,
    });
  }

  @Get('register-report/export/:jobId/status')
  @ApiOperation({ summary: 'Get status of queued Purchase Return Register export' })
  getRegisterExportStatus(@Param('jobId') jobId: string) {
    return this.purchaseReturnRegisterExportService.getJobStatus(jobId);
  }

  @Get('register-report/export/:jobId/download')
  @ApiOperation({ summary: 'Download completed Purchase Return Register export file' })
  downloadRegisterExport(@Param('jobId') jobId: string, @Res() res: any) {
    return this.purchaseReturnRegisterExportService.streamExportFile(jobId, res);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get purchase return by ID' })
  @ApiResponse({ status: 200, description: 'Purchase return details' })
  @ApiResponse({ status: 404, description: 'Purchase return not found' })
  findOne(@Param('id') id: string) {
    return this.purchaseReturnService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update purchase return' })
  @ApiResponse({ status: 200, description: 'Purchase return updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - validation failed' })
  update(@Param('id') id: string, @Body() updateDto: UpdatePurchaseReturnDto, @Req() req: any) {
    return this.purchaseReturnService.update(id, updateDto, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update purchase return status' })
  @ApiResponse({ status: 200, description: 'Status updated successfully' })
  updateStatus(
    @Param('id') id: string, 
    @Body() body: { status: string; approvedBy?: string },
    @Req() req: any
  ) {
    return this.purchaseReturnService.updateStatus(id, body.status, body.approvedBy, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete purchase return' })
  @ApiResponse({ status: 200, description: 'Purchase return deleted successfully' })
  @ApiResponse({ status: 400, description: 'Cannot delete non-draft return' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.purchaseReturnService.remove(id, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}