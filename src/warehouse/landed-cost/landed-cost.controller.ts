import { Body, Controller, Get, Post } from '@nestjs/common';
import { LandedCostService } from './landed-cost.service';
import { CreateLandedCostDto } from './dto/landed-cost.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateChargeTypeDto } from './dto/charge-type.dto';

@ApiTags('Landed Cost')
@Controller('api/landed-cost')
export class LandedCostController {
  constructor(private readonly service: LandedCostService) { }

  @Post()
  @ApiOperation({
    summary: 'Create Landed Cost: update stock ledger and value GRN',
  })
  create(@Body() dto: CreateLandedCostDto) {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List Landed Cost records' })
  list() {
    return this.service.list();
  }

  @Get('charge-types')
  @ApiOperation({ summary: 'List Landed Cost Charge Types' })
  listChargeTypes() {
    return this.service.listChargeTypes();
  }

  @Post('charge-types')
  @ApiOperation({ summary: 'Create Landed Cost Charge Type' })
  createChargeType(@Body() dto: CreateChargeTypeDto) {
    return this.service.createChargeType(dto);
  }
}
