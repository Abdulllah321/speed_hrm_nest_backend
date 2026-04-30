import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JournalVoucherService } from './journal-voucher.service';
import { CreateJournalVoucherDto } from './dto/create-journal-voucher.dto';
import { UpdateJournalVoucherDto } from './dto/update-journal-voucher.dto';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Journal Voucher')
@Controller('api/finance/journal-voucher')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class JournalVoucherController {
  constructor(private readonly journalVoucherService: JournalVoucherService) {}

  @Post()
  @Permissions('erp.finance.journal-voucher.create')
  create(@Body() createJournalVoucherDto: CreateJournalVoucherDto, @Req() req: any) {
    return this.journalVoucherService.create(createJournalVoucherDto, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @Permissions('erp.finance.journal-voucher.read')
  findAll() {
    return this.journalVoucherService.findAll();
  }

  @Get(':id')
  @Permissions('erp.finance.journal-voucher.read')
  findOne(@Param('id') id: string) {
    return this.journalVoucherService.findOne(id);
  }

  @Patch(':id')
  @Permissions('erp.finance.journal-voucher.update')
  update(
    @Param('id') id: string,
    @Body() updateJournalVoucherDto: UpdateJournalVoucherDto,
    @Req() req: any,
  ) {
    return this.journalVoucherService.update(id, updateJournalVoucherDto, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @Permissions('erp.finance.journal-voucher.delete')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.journalVoucherService.remove(id, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
