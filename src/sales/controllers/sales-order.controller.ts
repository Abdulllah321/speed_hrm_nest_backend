import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SalesOrderService } from '../services/sales-order.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateSalesOrderDto, UpdateSalesOrderDto } from '../dto/sales-order.dto';

@Controller('api/sales/orders')
@UseGuards(JwtAuthGuard)
export class SalesOrderController {
  constructor(private readonly salesOrderService: SalesOrderService) {}

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
  async create(@Body() createSalesOrderDto: CreateSalesOrderDto) {
    return this.salesOrderService.create(createSalesOrderDto);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateSalesOrderDto: UpdateSalesOrderDto,
  ) {
    return this.salesOrderService.update(id, updateSalesOrderDto);
  }

  @Post(':id/confirm')
  async confirm(@Param('id') id: string) {
    return this.salesOrderService.confirm(id);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string) {
    return this.salesOrderService.cancel(id);
  }

  @Post(':id/delivery-challan')
  async createDeliveryChallan(@Param('id') id: string, @Body() data: any) {
    return this.salesOrderService.createDeliveryChallan(id, data);
  }
}