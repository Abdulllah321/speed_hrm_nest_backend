import { PartialType } from '@nestjs/swagger';
import { CreateRebateNatureDto } from './create-rebate-nature.dto';

export class UpdateRebateNatureDto extends PartialType(CreateRebateNatureDto) {}
