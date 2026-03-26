import { Body, Controller, Get, Param, Post } from '@nestjs/common';
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

  @Post('local')
  @ApiOperation({
    summary: 'Create Local Landed Cost: simple posting for local purchases',
  })
  createLocal(@Body() dto: any) {
    return this.service.createLocal(dto);
  }

  @Post('post')
  @ApiOperation({
    summary: 'Post Landed Cost with charges',
  })
  post(@Body() dto: { grnId: string; charges: { accountId: string; amount: number }[] }) {
    return this.service.post(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List Landed Cost records' })
  list() {
    return this.service.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single Landed Cost record by ID' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
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
