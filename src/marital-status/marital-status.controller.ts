import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { MaritalStatusService } from './marital-status.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'

@Controller('api')
export class MaritalStatusController {
  constructor(private service: MaritalStatusService) {}

  @Get('marital-statuses')
  @UseGuards(JwtAuthGuard)
  async list() {
    return this.service.list()
  }

  @Get('marital-statuses/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }
}
