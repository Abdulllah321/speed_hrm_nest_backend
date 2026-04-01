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
import { SalesInvoiceService } from '../services/sales-invoice.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('api/sales/invoices')
@UseGuards(JwtAuthGuard)
export class SalesInvoiceController {
  constructor(private readonly salesInvoiceService: SalesInvoiceService) {}

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
  async update(@Param('id') id: string, @Body() updateData: any) {
    return this.salesInvoiceService.update(id, updateData);
  }

  @Post(':id/post')
  async post(@Param('id') id: string) {
    return this.salesInvoiceService.post(id);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string) {
    return this.salesInvoiceService.cancel(id);
  }
}