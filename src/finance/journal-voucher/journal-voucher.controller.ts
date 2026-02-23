import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { JournalVoucherService } from './journal-voucher.service';
import { CreateJournalVoucherDto } from './dto/create-journal-voucher.dto';
import { UpdateJournalVoucherDto } from './dto/update-journal-voucher.dto';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Journal Voucher')
@Controller('api/finance/journal-voucher')
export class JournalVoucherController {
  constructor(private readonly journalVoucherService: JournalVoucherService) {}

  @Post()
  create(@Body() createJournalVoucherDto: CreateJournalVoucherDto) {
    return this.journalVoucherService.create(createJournalVoucherDto);
  }

  @Get()
  findAll() {
    return this.journalVoucherService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.journalVoucherService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateJournalVoucherDto: UpdateJournalVoucherDto,
  ) {
    return this.journalVoucherService.update(id, updateJournalVoucherDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.journalVoucherService.remove(id);
  }
}
