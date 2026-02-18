import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { CompanyService } from './company.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class CreateCompanyDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  code!: string;
}

class UpdateCompanyDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  status?: string;
}

@Controller('api/admin/companies')
@UseGuards(JwtAuthGuard)
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  /**
   * Get all companies
   */
  @Get()
  async list() {
    return this.companyService.listCompanies();
  }

  /**
   * Check if any companies exist (for initial setup flow)
   */
  @Get('check')
  async checkCompanies() {
    const hasCompanies = await this.companyService.hasCompanies();
    return { status: true, hasCompanies };
  }

  /**
   * Get the first active company (for auto-selection)
   */
  @Get('first')
  async getFirstCompany() {
    return this.companyService.getFirstActiveCompany();
  }

  /**
   * Get a specific company by ID
   */
  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.companyService.getCompanyById(id);
  }

  /**
   * Get a specific company by code
   */
  @Get('by-code/:code')
  async getByCode(@Param('code') code: string) {
    return this.companyService.getCompanyByCode(code);
  }

  /**
   * Create a new company (provisions tenant database)
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateCompanyDto) {
    return this.companyService.createCompany({
      name: body.name,
      code: body.code,
    });
  }

  /**
   * Update company details
   */
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateCompanyDto) {
    return this.companyService.updateCompany(id, body);
  }
}
