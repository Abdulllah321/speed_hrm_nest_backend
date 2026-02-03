import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { PaymentVoucherService } from './payment-voucher.service';
import { CreatePaymentVoucherDto } from './dto/create-payment-voucher.dto';
import { UpdatePaymentVoucherDto } from './dto/update-payment-voucher.dto';
import { ApiQuery, ApiTags } from '@nestjs/swagger';

@ApiTags('Payment Voucher')
@Controller('finance/payment-vouchers') // Plural to match existing pattern or singular? User used plural in action mock: payment-vouchers
export class PaymentVoucherController {
    constructor(private readonly paymentVoucherService: PaymentVoucherService) { }

    @Post()
    create(@Body() createPaymentVoucherDto: CreatePaymentVoucherDto) {
        return this.paymentVoucherService.create(createPaymentVoucherDto);
    }

    @Get()
    @ApiQuery({ name: 'type', required: false, enum: ['bank', 'cash'] })
    findAll(@Query('type') type?: string) {
        return this.paymentVoucherService.findAll(type);
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.paymentVoucherService.findOne(id);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() updatePaymentVoucherDto: UpdatePaymentVoucherDto) {
        return this.paymentVoucherService.update(id, updatePaymentVoucherDto);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.paymentVoucherService.remove(id);
    }
}
