import { IsNotEmpty, IsString, IsOptional } from 'class-validator'

export class CreateDepartmentDto {
  @IsNotEmpty()
  @IsString()
  name: string

  @IsNotEmpty()
  @IsString()
  createdById: string
}

export class UpdateDepartmentDto {
    @IsNotEmpty()
    @IsString()
    id: string  

    @IsNotEmpty()
    @IsString()
    name: string

    @IsOptional()
    @IsString()
    headId?: string
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
  @IsNotEmpty()
  @IsString()
  id: string  

  @IsNotEmpty()
  @IsString()
  name: string

  @IsOptional()
  @IsString()
  headId?: string
}