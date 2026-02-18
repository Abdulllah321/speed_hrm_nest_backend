import { PartialType } from '@nestjs/mapped-types';
import { CreateReceiptVoucherDto } from './create-receipt-voucher.dto';

export class UpdateReceiptVoucherDto extends PartialType(
  CreateReceiptVoucherDto,
) {}
