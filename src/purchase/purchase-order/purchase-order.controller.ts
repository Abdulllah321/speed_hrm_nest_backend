import { Controller, Get, Post, Body, Param, Patch } from '@nestjs/common';
import { PurchaseOrderService } from './purchase-order.service';
import { CreatePurchaseOrderDto } from './dto/purchase-order.dto';

@Controller('api/purchase-order')
export class PurchaseOrderController {
    constructor(private readonly purchaseOrderService: PurchaseOrderService) { }

    @Get()
    findAll() {
        return this.purchaseOrderService.findAll();
    }

    @Get('pending-quotations')
    findPendingQuotations() {
        return this.purchaseOrderService.findPendingQuotations();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.purchaseOrderService.findOne(id);
    }

    @Post()
    create(@Body() createDto: CreatePurchaseOrderDto) {
        return this.purchaseOrderService.create(createDto);
    }

    @Patch(':id/status')
    updateStatus(@Param('id') id: string, @Body('status') status: string) {
        return this.purchaseOrderService.updateStatus(id, status);
    }
}
