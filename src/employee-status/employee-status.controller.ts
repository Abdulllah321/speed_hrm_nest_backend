import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { EmployeeStatusService } from './employee-status.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'

@Controller('api')
export class EmployeeStatusController {
  constructor(private service: EmployeeStatusService) {}

  @Get('employee-statuses')
  @UseGuards(JwtAuthGuard)
  async list() {
    return this.service.list()
  }

  @Get('employee-statuses/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }
}
