import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  UseGuards,
} from '@nestjs/common';
import { PaymentVoucherService } from './payment-voucher.service';
import { CreatePaymentVoucherDto } from './dto/create-payment-voucher.dto';
import { UpdatePaymentVoucherDto } from './dto/update-payment-voucher.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { ApiQuery, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Payment Voucher')
@Controller('api/finance/payment-vouchers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PaymentVoucherController {
  constructor(private readonly paymentVoucherService: PaymentVoucherService) {}

  @Post()
  @Permissions('erp.finance.payment-voucher.create')
  @ApiOperation({ summary: 'Create a new payment voucher' })
  @ApiResponse({ status: 201, description: 'Payment voucher created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - validation failed' })
  create(@Body() createPaymentVoucherDto: CreatePaymentVoucherDto) {
    return this.paymentVoucherService.create(createPaymentVoucherDto);
  }

  @Get()
  @Permissions('erp.finance.payment-voucher.read')
  @ApiOperation({ summary: 'Get all payment vouchers with optional filtering' })
  @ApiQuery({ name: 'type', required: false, enum: ['bank', 'cash'] })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'approved', 'rejected'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  findAll(
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit?: number,
    @Query('search') search?: string,
  ) {
    return this.paymentVoucherService.findAll({ type, status, page, limit, search });
  }

  @Get('next-pv-number')
  @Permissions('erp.finance.payment-voucher.read')
  @ApiOperation({ summary: 'Get next available PV number' })
  @ApiQuery({ name: 'type', required: true, enum: ['bank', 'cash'] })
  getNextPvNumber(@Query('type') type: string) {
    return this.paymentVoucherService.getNextPvNumber(type);
  }

  @Get('summary')
  @Permissions('erp.finance.payment-voucher.read')
  @ApiOperation({ summary: 'Get payment voucher summary statistics' })
  @ApiQuery({ name: 'type', required: false, enum: ['bank', 'cash'] })
  getSummary(@Query('type') type?: string) {
    return this.paymentVoucherService.getSummary(type);
  }

  @Get('debug-invoices')
  @Permissions('erp.finance.payment-voucher.read')
  @ApiOperation({ summary: 'Debug endpoint to check invoice data' })
  async debugInvoices() {
    return this.paymentVoucherService.debugInvoices();
  }

  @Get('test-suppliers')
  @Permissions('erp.finance.payment-voucher.read')
  @ApiOperation({ summary: 'Test endpoint to check all suppliers' })
  async testSuppliers() {
    return this.paymentVoucherService.testSuppliers();
  }

  @Get('suppliers-with-pending-invoices')
  @Permissions('erp.finance.payment-voucher.read')
  @ApiOperation({ summary: 'Get suppliers with pending invoices' })
  @ApiResponse({ status: 200, description: 'Suppliers with pending invoices retrieved successfully' })
  async getSuppliersWithPendingInvoices() {
    try {
      const result = await this.paymentVoucherService.getSuppliersWithPendingInvoices();
      console.log('Controller - Suppliers result:', result);
      return result;
    } catch (error) {
      console.error('Controller - Error getting suppliers:', error);
      throw error;
    }
  }

  @Get('pending-invoices/:supplierId')
  @Permissions('erp.finance.payment-voucher.read')
  @ApiOperation({ summary: 'Get pending invoices for a supplier' })
  @ApiResponse({ status: 200, description: 'Pending invoices retrieved successfully' })
  getPendingInvoicesBySupplier(@Param('supplierId') supplierId: string) {
    return this.paymentVoucherService.getPendingInvoicesBySupplier(supplierId);
  }

  @Get('advances/:supplierId')
  @Permissions('erp.finance.payment-voucher.read')
  @ApiOperation({ summary: 'Get unapplied advance payments for a supplier' })
  getAdvancesBySupplier(@Param('supplierId') supplierId: string) {
    return this.paymentVoucherService.getAdvancesBySupplier(supplierId);
  }

  @Get('supplier-summary/:supplierId')
  @Permissions('erp.finance.payment-voucher.read')
  @ApiOperation({ summary: 'Get AP balance and advance balance for a supplier' })
  getSupplierSummary(@Param('supplierId') supplierId: string) {
    return this.paymentVoucherService.getSupplierSummary(supplierId);
  }

  @Get('ledger/:supplierId')
  @Permissions('erp.finance.payment-voucher.read')
  @ApiOperation({ summary: 'Get full AP ledger statement for a supplier' })
  @ApiQuery({ name: 'fromDate', required: false, type: String })
  @ApiQuery({ name: 'toDate', required: false, type: String })
  getSupplierLedger(
    @Param('supplierId') supplierId: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.paymentVoucherService.getSupplierLedger(supplierId, fromDate, toDate);
  }

  @Get(':id')
  @Permissions('erp.finance.payment-voucher.read')
  @ApiOperation({ summary: 'Get payment voucher by ID' })
  @ApiResponse({ status: 200, description: 'Payment voucher found' })
  @ApiResponse({ status: 404, description: 'Payment voucher not found' })
  findOne(@Param('id') id: string) {
    return this.paymentVoucherService.findOne(id);
  }

  @Patch(':id')
  @Permissions('erp.finance.payment-voucher.update')
  @ApiOperation({ summary: 'Update payment voucher' })
  @ApiResponse({ status: 200, description: 'Payment voucher updated successfully' })
  @ApiResponse({ status: 404, description: 'Payment voucher not found' })
  update(
    @Param('id') id: string,
    @Body() updatePaymentVoucherDto: UpdatePaymentVoucherDto,
  ) {
    return this.paymentVoucherService.update(id, updatePaymentVoucherDto);
  }

  @Patch(':id/status')
  @Permissions('erp.finance.payment-voucher.approve')
  @ApiOperation({ summary: 'Update payment voucher status' })
  @ApiResponse({ status: 200, description: 'Status updated successfully' })
  updateStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateStatusDto,
  ) {
    return this.paymentVoucherService.updateStatus(id, updateStatusDto.status, updateStatusDto.remarks);
  }

  @Delete(':id')
  @Permissions('erp.finance.payment-voucher.delete')
  @ApiOperation({ summary: 'Delete payment voucher' })
  @ApiResponse({ status: 200, description: 'Payment voucher deleted successfully' })
  @ApiResponse({ status: 404, description: 'Payment voucher not found' })
  remove(@Param('id') id: string) {
    return this.paymentVoucherService.remove(id);
  }
}