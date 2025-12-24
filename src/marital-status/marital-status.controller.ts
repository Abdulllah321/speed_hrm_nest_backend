import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { MaritalStatusService } from './marital-status.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'

@ApiTags('Marital Status')
@Controller('api')
export class MaritalStatusController {
  constructor(private service: MaritalStatusService) {}

  @Get('marital-statuses')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all marital statuses' })
  async list() {
    return this.service.list()
  }

  @Get('marital-statuses/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get marital status by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }
}
