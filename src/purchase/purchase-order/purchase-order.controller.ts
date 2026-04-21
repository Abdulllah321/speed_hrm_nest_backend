import { Controller, Get, Post, Body, Param, Patch, UseGuards } from '@nestjs/common';
import { PurchaseOrderService } from './purchase-order.service';
import {
  CreatePurchaseOrderDto,
  AwardFromRfqDto,
  CreateMultiDirectPurchaseOrderDto,
} from './dto/purchase-order.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';

@Controller('api/purchase-order')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchaseOrderController {
  constructor(private readonly purchaseOrderService: PurchaseOrderService) {}

  @Get()
  @Permissions('erp.procurement.po.read')
  findAll() {
    return this.purchaseOrderService.findAll();
  }

  @Get('pending-quotations')
  @Permissions('erp.procurement.po.read')
  findPendingQuotations() {
    return this.purchaseOrderService.findPendingQuotations();
  }

  @Get(':id')
  @Permissions('erp.procurement.po.read')
  findOne(@Param('id') id: string) {
    return this.purchaseOrderService.findOne(id);
  }

  @Post()
  @Permissions('erp.procurement.po.create')
  create(@Body() createDto: CreatePurchaseOrderDto) {
    return this.purchaseOrderService.create(createDto);
  }

  @Post('award-from-rfq')
  @Permissions('erp.procurement.po.create')
  awardFromRfq(@Body() body: AwardFromRfqDto) {
    return this.purchaseOrderService.awardFromRfq(body);
  }

  @Post('multi-direct')
  @Permissions('erp.procurement.po.create')
  createMultiDirect(@Body() body: CreateMultiDirectPurchaseOrderDto) {
    return this.purchaseOrderService.createMultiDirect(body);
  }

  @Patch(':id/status')
  @Permissions('erp.procurement.po.update')
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.purchaseOrderService.updateStatus(id, status);
  }
}
