import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer-dto';

@Controller('api/sales/customers')
export class CustomerController {
  constructor(private readonly service: CustomerService) { }

  @Post()
  create(@Body() dto: CreateCustomerDto) {
    return this.service.create(dto);
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

  // ─── Standard CRUD (after specific routes) ────────────────────────
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
