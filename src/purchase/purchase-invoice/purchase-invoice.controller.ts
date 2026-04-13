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
} from '@nestjs/common';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { CreatePurchaseInvoiceDto, UpdatePurchaseInvoiceDto } from './dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';

@ApiTags('Purchase Invoice')
@Controller('api/purchase/purchase-invoices')
@UseGuards(JwtAuthGuard)
export class PurchaseInvoiceController {
  constructor(private readonly purchaseInvoiceService: PurchaseInvoiceService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new purchase invoice' })
  @ApiResponse({ status: 201, description: 'Purchase invoice created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - validation failed' })
  create(@Body() createPurchaseInvoiceDto: CreatePurchaseInvoiceDto) {
    return this.purchaseInvoiceService.create(createPurchaseInvoiceDto);
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
  ) {
    return this.purchaseInvoiceService.update(id, updatePurchaseInvoiceDto);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve purchase invoice' })
  @ApiResponse({ status: 200, description: 'Invoice approved successfully' })
  approve(@Param('id') id: string) {
    return this.purchaseInvoiceService.approve(id);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel purchase invoice' })
  @ApiResponse({ status: 200, description: 'Invoice cancelled successfully' })
  cancel(@Param('id') id: string, @Body() cancelDto: { reason?: string }) {
    return this.purchaseInvoiceService.cancel(id, cancelDto.reason);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete purchase invoice' })
  @ApiResponse({ status: 200, description: 'Purchase invoice deleted successfully' })
  @ApiResponse({ status: 404, description: 'Purchase invoice not found' })
  remove(@Param('id') id: string) {
    return this.purchaseInvoiceService.remove(id);
  }
}