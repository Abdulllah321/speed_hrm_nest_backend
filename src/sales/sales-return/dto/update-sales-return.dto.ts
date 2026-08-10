import { PartialType } from '@nestjs/mapped-types';
import { CreateSalesReturnDto } from './create-sales-return.dto';

export class UpdateSalesReturnDto extends PartialType(CreateSalesReturnDto) {}
