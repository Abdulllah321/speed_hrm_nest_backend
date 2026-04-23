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
} from '@nestjs/common';
import { ReceiptVoucherService } from './receipt-voucher.service';
import { CreateReceiptVoucherDto } from './dto/create-receipt-voucher.dto';
import { UpdateReceiptVoucherDto } from './dto/update-receipt-voucher.dto';
import { ApiQuery, ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Receipt Voucher')
@Controller('api/finance/receipt-vouchers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReceiptVoucherController {
  constructor(private readonly receiptVoucherService: ReceiptVoucherService) {}

  @Post()
  @Permissions('erp.finance.receipt-voucher.create')
  @ApiOperation({ summary: 'Create a new receipt voucher' })
  create(@Body() dto: CreateReceiptVoucherDto) {
    return this.receiptVoucherService.create(dto);
  }

  @Get()
  @Permissions('erp.finance.receipt-voucher.read')
  @ApiOperation({ summary: 'Get all receipt vouchers' })
  @ApiQuery({ name: 'type', required: false, enum: ['bank', 'cash'] })
  findAll(@Query('type') type?: string) {
    return this.receiptVoucherService.findAll(type);
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

  @Delete(':id')
  @Permissions('erp.finance.receipt-voucher.delete')
  @ApiOperation({ summary: 'Delete receipt voucher' })
  remove(@Param('id') id: string) {
    return this.receiptVoucherService.remove(id);
  }
}
