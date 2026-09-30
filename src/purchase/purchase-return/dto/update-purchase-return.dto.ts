import { PartialType } from '@nestjs/swagger';
import { CreatePurchaseReturnDto } from './create-purchase-return.dto';

export class UpdatePurchaseReturnDto extends PartialType(
  CreatePurchaseReturnDto,
) {}
