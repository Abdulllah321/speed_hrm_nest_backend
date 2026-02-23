import { PartialType } from '@nestjs/mapped-types';
import { CreatePaymentVoucherDto } from './create-payment-voucher.dto';

export class UpdatePaymentVoucherDto extends PartialType(
  CreatePaymentVoucherDto,
) {}
