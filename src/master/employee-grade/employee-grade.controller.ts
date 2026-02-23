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
import { EmployeeGradeService } from './employee-grade.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

@ApiTags('Employee Grade')
@Controller('api')
export class EmployeeGradeController {
  constructor(private service: EmployeeGradeService) {}

  @Get('employee-grades')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.employee-grade.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all employee grades' })
  async list() {
    return this.service.list();
  }

  @Get('employee-grades/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.employee-grade.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get employee grade by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('employee-grades')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.employee-grade.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create employee grade' })
  async create(@Body() body: { grade: string; status?: string }) {
    return this.service.create(body);
  }

  @Put('employee-grades/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.employee-grade.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update employee grade' })
  async update(
    @Param('id') id: string,
    @Body() body: { grade?: string; status?: string },
  ) {
    return this.service.update(id, body);
  }

  @Delete('employee-grades/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.employee-grade.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete employee grade' })
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  @Post('employee-grades/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.employee-grade.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk create employee grades' })
  async bulkCreate(
    @Body() body: { items: { grade: string; status?: string }[] },
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
