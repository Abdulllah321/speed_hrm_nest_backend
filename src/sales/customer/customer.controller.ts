import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer-dto';

@Controller('api/sales/customers')
export class CustomerController {
  constructor(private readonly service: CustomerService,) { }

  private ctx(req: any) {
    return {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };
  }

  @Post()
  create(@Body() dto: CreateCustomerDto, @Req() req) {
    return this.service.create(dto, this.ctx(req));
  }

  @Get()
  findAll(@Query('search') search?: string) {
    return this.service.findAll(search);
  }

  // ─── Customer Ledger Endpoints (MUST come before :id routes) ──────
  @Get('ledger/summary')
  getCustomerLedger(
    @Query('customerId') customerId?: string,
    @Query('search') search?: string,
  ) {
    return this.service.getCustomerLedger(customerId, search);
  }

  @Get('ledger/:customerId/transactions')
  getCustomerTransactions(@Param('customerId') customerId: string) {
    return this.service.getCustomerTransactions(customerId);
  }

  @Post('ledger/:customerId/pay-credit')
  recordCreditPayment(
    @Param('customerId') customerId: string,
    @Body() dto: { orderIds: string[]; paymentMethod: string; notes?: string; cardLast4?: string; slipRef?: string },
    @Req() req,
  ) {
    return this.service.recordCreditPayment(customerId, dto, this.ctx(req));
  }

  // ─── Standard CRUD (after specific routes) ────────────────────────
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto, @Req() req) {
    return this.service.update(id, dto, this.ctx(req));
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, this.ctx(req));
  }
}
