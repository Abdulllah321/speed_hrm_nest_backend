import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { EmployeeGradeService } from './employee-grade.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'

@Controller('api')
export class EmployeeGradeController {
  constructor(private service: EmployeeGradeService) {}

  @Get('employee-grades')
  @UseGuards(JwtAuthGuard)
  async list() {
    return this.service.list()
  }

  @Get('employee-grades/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }
}
