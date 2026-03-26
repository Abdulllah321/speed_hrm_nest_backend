import { Controller, Get, Param, Query } from '@nestjs/common';
import { DebitNoteService } from './debit-note.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Debit Notes')
@Controller('api/purchase/debit-notes')
export class DebitNoteController {
  constructor(private readonly debitNoteService: DebitNoteService) {}

  @Get()
  findAll() {
    return this.debitNoteService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.debitNoteService.findOne(id);
  }

  @Get('supplier/:supplierId')
  findBySupplier(@Param('supplierId') supplierId: string) {
    return this.debitNoteService.findBySupplier(supplierId);
  }

  @Get('invoice/:invoiceId')
  findByInvoice(@Param('invoiceId') invoiceId: string) {
    return this.debitNoteService.findByInvoice(invoiceId);
  }
}
