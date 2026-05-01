import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { DeliveryChallanService } from '../services/delivery-challan.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateDeliveryChallanDto } from '../dto/delivery-challan.dto';

@Controller('api/sales/delivery-challans')
@UseGuards(JwtAuthGuard)
export class DeliveryChallanController {
  constructor(private readonly deliveryChallanService: DeliveryChallanService,) {}

  @Get()
  async findAll(
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.deliveryChallanService.findAll(search, status);
  }

  @Post()
  async create(@Body() createData: CreateDeliveryChallanDto, @Req() req: any) {
    return this.deliveryChallanService.create(createData, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.deliveryChallanService.findOne(id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateData: any, @Req() req: any) {
    return this.deliveryChallanService.update(id, updateData, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/deliver')
  async deliver(@Param('id') id: string, @Req() req: any) {
    return this.deliveryChallanService.deliver(id, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/invoice')
  async createInvoice(@Param('id') id: string, @Body() data: any, @Req() req: any) {
    return this.deliveryChallanService.createInvoice(id, data, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Req() req: any) {
    return this.deliveryChallanService.cancel(id, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}