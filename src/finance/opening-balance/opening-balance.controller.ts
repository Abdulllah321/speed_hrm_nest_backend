import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OpeningBalanceService } from './opening-balance.service';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';

@ApiTags('Finance - Opening Balance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/finance/opening-balance')
export class OpeningBalanceController {
  constructor(private readonly openingBalanceService: OpeningBalanceService) {}

  @Post()
  async create(@Body() dto: CreateOpeningBalanceDto) {
    return this.openingBalanceService.createOpeningBalance(dto);
  }

  @Get()
  async findAll() {
    return this.openingBalanceService.getOpeningBalances();
  }
}
