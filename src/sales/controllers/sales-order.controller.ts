import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { SalesOrderService } from '../services/sales-order.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateSalesOrderDto, UpdateSalesOrderDto } from '../dto/sales-order.dto';

@Controller('api/sales/orders')
@UseGuards(JwtAuthGuard)
export class SalesOrderController {
  constructor(private readonly salesOrderService: SalesOrderService,) {}

  @Get()
  async findAll(
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.salesOrderService.findAll(search, status);
  }

  @Get('available-for-delivery')
  async findAvailableForDelivery() {
    return this.salesOrderService.findAvailableForDelivery();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.salesOrderService.findOne(id);
  }

  @Post()
  async create(@Body() createSalesOrderDto: CreateSalesOrderDto, @Req() req: any) {
    return this.salesOrderService.create(createSalesOrderDto, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateSalesOrderDto: UpdateSalesOrderDto,
    @Req() req: any,
  ) {
    return this.salesOrderService.update(id, updateSalesOrderDto, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/confirm')
  async confirm(@Param('id') id: string, @Req() req: any) {
    return this.salesOrderService.confirm(id, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Req() req: any) {
    return this.salesOrderService.cancel(id, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/verify')
  async verify(
    @Param('id') id: string,
    @Body('items') items: any[],
    @Req() req: any,
  ) {
    return this.salesOrderService.verify(id, items, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}