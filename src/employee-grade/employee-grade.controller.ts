import { Controller, Get, Param, UseGuards, Post, Body } from '@nestjs/common'
import { EmployeeGradeService } from './employee-grade.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'

@ApiTags('Employee Grade')
@Controller('api')
export class EmployeeGradeController {
  constructor(private service: EmployeeGradeService) { }

  @Get('employee-grades')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all employee grades' })
  async list() {
    return this.service.list()
  }

  @Get('employee-grades/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get employee grade by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('employee-grades/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk create employee grades' })
  async bulkCreate(@Body() body: { items: { grade: string; status?: string }[] }) {
    if (!body || !Array.isArray(body.items)) {
      return { status: false, message: 'Invalid payload, expected object with items array' };
    }
    return this.service.bulkCreate(body.items);
  }
}
