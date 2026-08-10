import { Controller, Get, Post, Body, Patch, Param, Delete, Query, Req } from '@nestjs/common';
import { SalesReturnService } from './sales-return.service';
import { CreateSalesReturnDto } from './dto/create-sales-return.dto';
import { UpdateSalesReturnDto } from './dto/update-sales-return.dto';

@Controller('sales/sales-returns')
export class SalesReturnController {
  constructor(private readonly salesReturnService: SalesReturnService) {}

  @Post()
  create(@Body() createDto: CreateSalesReturnDto, @Req() req: any) {
    const ctx = {
      userId: req.user?.id || req.user?.sub,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    };
    return this.salesReturnService.create(createDto, ctx);
  }

  @Get('eligible-invoices')
  getEligibleInvoices() {
    return this.salesReturnService.getEligibleInvoices();
  }

  @Get('eligible-challans')
  getEligibleChallans() {
    return this.salesReturnService.getEligibleChallans();
  }

  @Get('next-return-number')
  getNextReturnNumber() {
    return this.salesReturnService.getNextReturnNumber();
  }

  @Get()
  findAll(@Query('status') status?: string) {
    return this.salesReturnService.findAll(status);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.salesReturnService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdateSalesReturnDto, @Req() req: any) {
    const ctx = {
      userId: req.user?.id || req.user?.sub,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    };
    return this.salesReturnService.update(id, updateDto, ctx);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string; approvedBy?: string },
    @Req() req: any,
  ) {
    const ctx = {
      userId: req.user?.id || req.user?.sub,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    };
    return this.salesReturnService.updateStatus(id, body.status, body.approvedBy, ctx);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    const ctx = {
      userId: req.user?.id || req.user?.sub,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    };
    return this.salesReturnService.remove(id, ctx);
  }
}
