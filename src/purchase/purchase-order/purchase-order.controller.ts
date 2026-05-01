import { Controller, Get, Post, Body, Param, Patch, UseGuards, Req } from '@nestjs/common';
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
  constructor(private readonly purchaseOrderService: PurchaseOrderService,) {}

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
  create(@Body() createDto: CreatePurchaseOrderDto, @Req() req: any) {
    return this.purchaseOrderService.create(createDto, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('award-from-rfq')
  @Permissions('erp.procurement.po.create')
  awardFromRfq(@Body() body: AwardFromRfqDto, @Req() req: any) {
    return this.purchaseOrderService.awardFromRfq(body, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('multi-direct')
  @Permissions('erp.procurement.po.create')
  createMultiDirect(@Body() body: CreateMultiDirectPurchaseOrderDto, @Req() req: any) {
    return this.purchaseOrderService.createMultiDirect(body, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Patch(':id/status')
  @Permissions('erp.procurement.po.update')
  updateStatus(@Param('id') id: string, @Body('status') status: string, @Req() req: any) {
    return this.purchaseOrderService.updateStatus(id, status, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
