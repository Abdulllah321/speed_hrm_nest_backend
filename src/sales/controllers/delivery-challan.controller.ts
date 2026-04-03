import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DeliveryChallanService } from '../services/delivery-challan.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateDeliveryChallanDto } from '../dto/delivery-challan.dto';

@Controller('api/sales/delivery-challans')
@UseGuards(JwtAuthGuard)
export class DeliveryChallanController {
  constructor(private readonly deliveryChallanService: DeliveryChallanService) {}

  @Get()
  async findAll(
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.deliveryChallanService.findAll(search, status);
  }

  @Post()
  async create(@Body() createData: CreateDeliveryChallanDto) {
    return this.deliveryChallanService.create(createData);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.deliveryChallanService.findOne(id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateData: any) {
    return this.deliveryChallanService.update(id, updateData);
  }

  @Post(':id/deliver')
  async deliver(@Param('id') id: string) {
    return this.deliveryChallanService.deliver(id);
  }

  @Post(':id/invoice')
  async createInvoice(@Param('id') id: string, @Body() data: any) {
    return this.deliveryChallanService.createInvoice(id, data);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string) {
    return this.deliveryChallanService.cancel(id);
  }
}