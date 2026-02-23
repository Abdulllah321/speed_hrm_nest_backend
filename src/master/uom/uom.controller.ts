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
import { UomService } from './uom.service';
import { CreateUomDto } from './dto/create-uom.dto';
import { UpdateUomDto } from './dto/update-uom.dto';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@Controller('api/master/erp/uom')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UomController {
  constructor(private readonly uomService: UomService) {}

  @Post()
  @Permissions('erp.uom.create')
  async create(@Body() createUomDto: CreateUomDto) {
    const data = await this.uomService.create(createUomDto);
    return { status: true, message: 'UOM created successfully', data };
  }

  @Get()
  @Permissions('erp.uom.read')
  async findAll() {
    const data = await this.uomService.findAll();
    return { status: true, data };
  }

  @Get(':id')
  @Permissions('erp.uom.read')
  async findOne(@Param('id') id: string) {
    const data = await this.uomService.findOne(id);
    return { status: true, data };
  }

  @Patch(':id')
  @Permissions('erp.uom.update')
  async update(@Param('id') id: string, @Body() updateUomDto: UpdateUomDto) {
    const data = await this.uomService.update(id, updateUomDto);
    return { status: true, message: 'UOM updated successfully', data };
  }

  @Delete(':id')
  @Permissions('erp.uom.delete')
  async remove(@Param('id') id: string) {
    await this.uomService.remove(id);
    return { status: true, message: 'UOM deleted successfully' };
  }
}
