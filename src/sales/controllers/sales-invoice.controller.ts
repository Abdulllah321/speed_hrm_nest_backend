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
import { SalesInvoiceService } from '../services/sales-invoice.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('api/sales/invoices')
@UseGuards(JwtAuthGuard)
export class SalesInvoiceController {
  constructor(private readonly salesInvoiceService: SalesInvoiceService,) {}

  @Get()
  async findAll(
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.salesInvoiceService.findAll(search, status);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.salesInvoiceService.findOne(id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateData: any, @Req() req: any) {
    return this.salesInvoiceService.update(id, updateData, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/post')
  async post(@Param('id') id: string, @Req() req: any) {
    return this.salesInvoiceService.post(id, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Req() req: any) {
    return this.salesInvoiceService.cancel(id, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}