import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Req,
} from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Warehouse')
@Controller('api/warehouse')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService,) { }

  @Post()
  @ApiOperation({ summary: 'Create a new warehouse' })
  create(@Body() createWarehouseDto: any, @Req() req: any) {
    return this.warehouseService.createWarehouse(createWarehouseDto, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @ApiOperation({ summary: 'List all warehouses' })
  findAll() {
    return this.warehouseService.findAllWarehouses();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get warehouse details' })
  findOne(@Param('id') id: string) {
    return this.warehouseService.findOneWarehouse(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update warehouse' })
  update(@Param('id') id: string, @Body() updateWarehouseDto: any, @Req() req: any) {
    return this.warehouseService.updateWarehouse(id, updateWarehouseDto, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete warehouse' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.warehouseService.removeWarehouse(id, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
