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
  Req,
} from '@nestjs/common';
import { ReceiptVoucherService } from './receipt-voucher.service';
import { CreateReceiptVoucherDto } from './dto/create-receipt-voucher.dto';
import { UpdateReceiptVoucherDto } from './dto/update-receipt-voucher.dto';
import { ApiQuery, ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';

import { UpdateStatusDto } from './dto/update-status.dto';

@ApiTags('Receipt Voucher')
@Controller('api/finance/receipt-vouchers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReceiptVoucherController {
  constructor(private readonly receiptVoucherService: ReceiptVoucherService,) {}

  @Post()
  @Permissions('erp.finance.receipt-voucher.create')
  @ApiOperation({ summary: 'Create a new receipt voucher' })
  create(@Body() dto: CreateReceiptVoucherDto, @Req() req: any) {
    return this.receiptVoucherService.create(dto, { userId: req.user?.id });
  }

  @Get()
  @Permissions('erp.finance.receipt-voucher.read')
  @ApiOperation({ summary: 'Get all receipt vouchers' })
  @ApiQuery({ name: 'type', required: false, enum: ['bank', 'cash'] })
  findAll(
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('accountId') accountId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : undefined;
    const limitNum = limit ? parseInt(limit, 10) : undefined;
    return this.receiptVoucherService.findAll({ type, status, fromDate, toDate, accountId, page: pageNum, limit: limitNum, search });
  }

  @Get('missing-tag-accounts')
  @Permissions('erp.finance.receipt-voucher.read')
  @ApiOperation({ summary: 'Get receipt vouchers where tagAccount (sub-ledger) is missing/unattached' })
  @ApiQuery({ name: 'type', required: false, enum: ['bank', 'cash'] })
  findMissingTagAccounts(@Query('type') type?: string) {
    return this.receiptVoucherService.findMissingTagAccounts(type);
  }

  @Get('customers')
  @Permissions('erp.finance.receipt-voucher.read')
  @ApiOperation({ summary: 'Get all customers for receipt voucher creation' })
  getAllCustomers() {
    return this.receiptVoucherService.getAllCustomers();
  }

  @Get('pending-invoices/:customerId')
  @Permissions('erp.finance.receipt-voucher.read')
  @ApiOperation({ summary: 'Get pending/partial sales invoices for a customer' })
  getPendingInvoicesByCustomer(@Param('customerId') customerId: string) {
    return this.receiptVoucherService.getPendingInvoicesByCustomer(customerId);
  }

  @Get(':id')
  @Permissions('erp.finance.receipt-voucher.read')
  @ApiOperation({ summary: 'Get receipt voucher by ID' })
  findOne(@Param('id') id: string) {
    return this.receiptVoucherService.findOne(id);
  }

  @Patch(':id')
  @Permissions('erp.finance.receipt-voucher.update')
  @ApiOperation({ summary: 'Update receipt voucher' })
  update(@Param('id') id: string, @Body() dto: UpdateReceiptVoucherDto) {
    return this.receiptVoucherService.update(id, dto);
  }

  @Patch(':id/status')
  @Permissions('erp.finance.receipt-voucher.approve')
  @ApiOperation({ summary: 'Update receipt voucher status' })
  updateStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateStatusDto,
    @Req() req: any,
  ) {
    return this.receiptVoucherService.updateStatus(id, updateStatusDto.status, updateStatusDto.remarks, { userId: req.user?.id });
  }

  @Patch(':id/unapprove')
  @Permissions('erp.finance.receipt-voucher.approve')
  @ApiOperation({ summary: 'Unapprove and unpost receipt voucher' })
  unapprove(
    @Param('id') id: string,
    @Body() body: { remarks?: string },
    @Req() req: any,
  ) {
    return this.receiptVoucherService.unapprove(id, body?.remarks, { userId: req.user?.id });
  }

  @Patch(':id/print')
  @Permissions('erp.finance.receipt-voucher.read')
  @ApiOperation({ summary: 'Mark receipt voucher as printed' })
  markAsPrinted(@Param('id') id: string, @Req() req: any) {
    return this.receiptVoucherService.markAsPrinted(id, { userId: req.user?.id });
  }

  @Delete(':id')
  @Permissions('erp.finance.receipt-voucher.delete')
  @ApiOperation({ summary: 'Delete receipt voucher' })
  remove(@Param('id') id: string) {
    return this.receiptVoucherService.remove(id);
  }
}
