import { Controller, Get, Param, UseGuards, Post, Body } from '@nestjs/common'
import { EmployeeStatusService } from './employee-status.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'

@ApiTags('Employee Status')
@Controller('api')
export class EmployeeStatusController {
  constructor(private service: EmployeeStatusService) { }

  @Get('employee-statuses')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all employee statuses' })
  async list() {
    return this.service.list()
  }

  @Get('employee-statuses/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get employee status by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('employee-statuses/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk create employee statuses' })
  async bulkCreate(@Body() body: { items: { status: string; statusType?: string }[] }) {
    if (!body || !Array.isArray(body.items)) {
      return { status: false, message: 'Invalid payload, expected object with items array' };
    }
    return this.service.bulkCreate(body.items);
  }
}
