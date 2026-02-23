import { Body, Controller, Get, Post } from '@nestjs/common';
import { LandedCostService } from './landed-cost.service';
import { PostLandedCostDtoWithRates } from './dto/landed-cost.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateChargeTypeDto } from './dto/charge-type.dto';

@ApiTags('Landed Cost')
@Controller('api/landed-cost')
export class LandedCostController {
  constructor(private readonly service: LandedCostService) {}

  @Post('post')
  @ApiOperation({
    summary: 'Post Landed Cost: move stock to warehouse and value GRN',
  })
  post(@Body() dto: PostLandedCostDtoWithRates) {
    return this.service.post(dto);
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
