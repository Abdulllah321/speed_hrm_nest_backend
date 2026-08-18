import { Controller, Get, Param } from '@nestjs/common';
import { CreditNoteService } from './credit-note.service';

@Controller('api/sales/credit-notes')
export class CreditNoteController {
  constructor(private readonly creditNoteService: CreditNoteService) {}

  @Get()
  findAll() {
    return this.creditNoteService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.creditNoteService.findOne(id);
  }
}
