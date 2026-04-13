import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { TaxRateService } from './tax-rate.service';
import { CreateTaxRateDto, UpdateTaxRateDto } from './tax-rate.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { Permissions } from '../../../common/decorators/permissions.decorator';

@Controller('api/master/erp/tax-rate')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TaxRateController {
  constructor(private readonly service: TaxRateService) {}

  @Post()
  @Permissions('master.tax-rate.create')
  async create(@Body() dto: CreateTaxRateDto) {
    const result = await this.service.create(dto);
    return {
      status: true,
      message: 'Tax Rate created successfully',
      data: result.data,
    };
  }

  @Get()
  @Permissions('master.tax-rate.read')
  async list() {
    const result = await this.service.list();
    return { status: true, data: result.data };
  }

  @Get(':id')
  @Permissions('master.tax-rate.read')
  async get(@Param('id') id: string) {
    const result = await this.service.get(id);
    return { status: true, data: result.data };
  }

  @Patch(':id')
  @Permissions('master.tax-rate.update')
  async update(@Param('id') id: string, @Body() dto: UpdateTaxRateDto) {
    const result = await this.service.update(id, dto);
    return {
      status: true,
      message: 'Tax Rate updated successfully',
      data: result.data,
    };
  }

  @Delete(':id')
  @Permissions('master.tax-rate.delete')
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
    return { status: true, message: 'Tax Rate deleted successfully' };
  }
}
