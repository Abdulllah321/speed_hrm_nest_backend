import {
  Controller,
  Get,
  Param,
  UseGuards,
  Post,
  Body,
  Put,
  Delete,
} from '@nestjs/common';
import { EmployeeStatusService } from './employee-status.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

@ApiTags('Employee Status')
@Controller('api')
export class EmployeeStatusController {
  constructor(private service: EmployeeStatusService) {}

  @Get('employee-statuses')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all employee statuses' })
  async list() {
    return this.service.list();
  }

  @Get('employee-statuses/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get employee status by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('employee-statuses')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create employee status' })
  async create(@Body() body: { status: string; statusType?: string }) {
    return this.service.create(body);
  }

  @Put('employee-statuses/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update employee status' })
  async update(
    @Param('id') id: string,
    @Body() body: { status?: string; statusType?: string },
  ) {
    return this.service.update(id, body);
  }

  @Delete('employee-statuses/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete employee status' })
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  @Post('employee-statuses/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk create employee statuses' })
  async bulkCreate(
    @Body() body: { items: { status: string; statusType?: string }[] },
  ) {
    if (!body || !Array.isArray(body.items)) {
      return {
        status: false,
        message: 'Invalid payload, expected object with items array',
      };
    }
    return this.service.bulkCreate(body.items);
  }
}
