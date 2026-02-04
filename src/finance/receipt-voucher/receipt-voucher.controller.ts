import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ReceiptVoucherService } from './receipt-voucher.service';
import { CreateReceiptVoucherDto } from './dto/create-receipt-voucher.dto';
import { UpdateReceiptVoucherDto } from './dto/update-receipt-voucher.dto';
import { ApiQuery, ApiTags } from '@nestjs/swagger';

@ApiTags('Receipt Voucher')
@Controller('api/finance/receipt-vouchers')
export class ReceiptVoucherController {
    constructor(private readonly receiptVoucherService: ReceiptVoucherService) { }

    @Post()
    create(@Body() createReceiptVoucherDto: CreateReceiptVoucherDto) {
        return this.receiptVoucherService.create(createReceiptVoucherDto);
    }

    @Get()
    @ApiQuery({ name: 'type', required: false, enum: ['bank', 'cash'] })
    findAll(@Query('type') type?: string) {
        return this.receiptVoucherService.findAll(type);
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.receiptVoucherService.findOne(id);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() updateReceiptVoucherDto: UpdateReceiptVoucherDto) {
        return this.receiptVoucherService.update(id, updateReceiptVoucherDto);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.receiptVoucherService.remove(id);
    }
}
