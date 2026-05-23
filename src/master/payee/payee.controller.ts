import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Request } from '@nestjs/common';
import { PayeeService } from './payee.service';
import { CreatePayeeDto, UpdatePayeeDto } from './dto/payee.dto';

@Controller('api/payees')
export class PayeeController {
  constructor(private readonly payeeService: PayeeService) {}

  @Post(':type')
  create(
    @Param('type') type: 'director' | 'salary' | 'tax',
    @Body() createPayeeDto: CreatePayeeDto,
    @Request() req: any
  ) {
    return this.payeeService.create(type, createPayeeDto, req.user?.id);
  }

  @Get(':type')
  findAll(@Param('type') type: 'director' | 'salary' | 'tax') {
    return this.payeeService.findAll(type);
  }

  @Get(':type/:id')
  findOne(
    @Param('type') type: 'director' | 'salary' | 'tax',
    @Param('id') id: string
  ) {
    return this.payeeService.findOne(type, id);
  }

  @Patch(':type/:id')
  update(
    @Param('type') type: 'director' | 'salary' | 'tax',
    @Param('id') id: string,
    @Body() updatePayeeDto: UpdatePayeeDto
  ) {
    return this.payeeService.update(type, id, updatePayeeDto);
  }

  @Delete(':type/:id')
  remove(
    @Param('type') type: 'director' | 'salary' | 'tax',
    @Param('id') id: string
  ) {
    return this.payeeService.remove(type, id);
  }
}
