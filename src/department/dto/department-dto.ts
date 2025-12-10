import { IsNotEmpty, IsString } from 'class-validator'

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
}

export class UpdateSubDepartmentDto {
  @IsNotEmpty()
  @IsString()
  id: string  

  @IsNotEmpty()
  @IsString()
  name: string
}