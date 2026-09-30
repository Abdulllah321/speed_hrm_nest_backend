import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

export class UpdateStatusDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['draft', 'pending_check', 'pending_approval', 'approved', 'rejected'])
  status: string;

  @IsString()
  @IsOptional()
  remarks?: string;
}
