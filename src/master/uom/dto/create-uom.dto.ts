import { IsString, IsNotEmpty } from 'class-validator';

export class CreateUomDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}
