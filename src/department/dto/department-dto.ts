import { IsNotEmpty, IsString, IsOptional, IsArray, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

export class CreateDepartmentDto {
  @IsNotEmpty()
  @IsString()
  name: string

  @IsNotEmpty()
  @IsString()
  createdById: string

  @IsOptional()
  @IsString()
  allocationId?: string
}

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString({ message: 'id must be a string' })
  id?: string

  @IsNotEmpty()
  @IsString()
  name: string

  @IsOptional()
  @IsString()
  headId?: string

  @IsOptional()
  @IsString()
  allocationId?: string
}

// DTO for bulk updates where id is required in each item
export class BulkUpdateDepartmentItemDto {
  @IsNotEmpty({ message: 'id must be a string, id should not be empty' })
  @IsString({ message: 'id must be a string, id should not be empty' })
  id: string

  @IsNotEmpty()
  @IsString()
  name: string

  @IsOptional()
  @IsString()
  headId?: string

  @IsOptional()
  @IsString()
  allocationId?: string
}

export class BulkUpdateDepartmentDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateDepartmentItemDto)
  items: BulkUpdateDepartmentItemDto[]
}

export class CreateSubDepartmentDto {
  @IsNotEmpty()
  @IsString()
  name: string

  @IsNotEmpty()
  @IsString()
  departmentId: string

  @IsNotEmpty()
  @IsString()
  createdById: string

  @IsOptional()
  @IsString()
  headId?: string
}

export class UpdateSubDepartmentDto {
  @IsOptional()
  @IsString({ message: 'id must be a string' })
  id?: string

  @IsNotEmpty()
  @IsString()
  name: string

  @IsOptional()
  @IsString()
  headId?: string

  @IsOptional()
  @IsString()
  departmentId?: string  // Allow but will be ignored in update
}