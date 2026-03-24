import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

export class UpdateStatusDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['pending', 'approved', 'rejected'])
  status: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}