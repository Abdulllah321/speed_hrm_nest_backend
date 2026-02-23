import { PartialType } from '@nestjs/mapped-types';
import { CreateJournalVoucherDto } from './create-journal-voucher.dto';

export class UpdateJournalVoucherDto extends PartialType(
  CreateJournalVoucherDto,
) {}
