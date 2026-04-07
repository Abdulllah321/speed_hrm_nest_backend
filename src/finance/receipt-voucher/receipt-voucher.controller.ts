import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { ReceiptVoucherService } from './receipt-voucher.service';
import { CreateReceiptVoucherDto } from './dto/create-receipt-voucher.dto';
import { UpdateReceiptVoucherDto } from './dto/update-receipt-voucher.dto';
import { ApiQuery, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Receipt Voucher')
@Controller('api/finance/receipt-vouchers')
export class ReceiptVoucherController {
  constructor(private readonly receiptVoucherService: ReceiptVoucherService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new receipt voucher' })
  create(@Body() dto: CreateReceiptVoucherDto) {
    return this.receiptVoucherService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all receipt vouchers' })
  @ApiQuery({ name: 'type', required: false, enum: ['bank', 'cash'] })
  findAll(@Query('type') type?: string) {
    return this.receiptVoucherService.findAll(type);
  }

  @Get('customers')
  @ApiOperation({ summary: 'Get all customers for receipt voucher creation' })
  getAllCustomers() {
    return this.receiptVoucherService.getAllCustomers();
  }

  @Get('pending-invoices/:customerId')
  @ApiOperation({ summary: 'Get pending/partial sales invoices for a customer' })
  getPendingInvoicesByCustomer(@Param('customerId') customerId: string) {
    return this.receiptVoucherService.getPendingInvoicesByCustomer(customerId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get receipt voucher by ID' })
  findOne(@Param('id') id: string) {
    return this.receiptVoucherService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update receipt voucher' })
  update(@Param('id') id: string, @Body() dto: UpdateReceiptVoucherDto) {
    return this.receiptVoucherService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete receipt voucher' })
  remove(@Param('id') id: string) {
    return this.receiptVoucherService.remove(id);
  }
}
