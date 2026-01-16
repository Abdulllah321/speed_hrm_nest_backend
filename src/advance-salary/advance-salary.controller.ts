import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdvanceSalaryService } from './advance-salary.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CreateAdvanceSalaryDto,
  UpdateAdvanceSalaryDto,
  ApproveAdvanceSalaryDto,
} from './dto/create-advance-salary.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';

@ApiTags('Advance Salary')
@Controller('api')
export class AdvanceSalaryController {
  constructor(private service: AdvanceSalaryService) {}

  @Get('advance-salaries')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List advance salaries' })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'deductionMonth', required: false })
  @ApiQuery({ name: 'deductionYear', required: false })
  @ApiQuery({ name: 'deductionMonthYear', required: false })
  @ApiQuery({ name: 'approvalStatus', required: false })
  @ApiQuery({ name: 'status', required: false })
  async list(
    @Query('employeeId') employeeId?: string,
    @Query('deductionMonth') deductionMonth?: string,
    @Query('deductionYear') deductionYear?: string,
    @Query('deductionMonthYear') deductionMonthYear?: string,
    @Query('approvalStatus') approvalStatus?: string,
    @Query('status') status?: string,
  ) {
    return this.service.list({
      employeeId,
      deductionMonth,
      deductionYear,
      deductionMonthYear,
      approvalStatus,
      status,
    });
  }

  @Get('advance-salaries/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get advance salary by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('advance-salaries')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create advance salary request' })
  async create(@Body() body: CreateAdvanceSalaryDto, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('advance-salaries/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update advance salary request' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateAdvanceSalaryDto,
    @Req() req,
  ) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('advance-salaries/:id/approve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve advance salary request' })
  async approve(
    @Param('id') id: string,
    @Body() body: ApproveAdvanceSalaryDto,
    @Req() req,
  ) {
    return this.service.approve(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('advance-salaries/:id/reject')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject advance salary request' })
  async reject(
    @Param('id') id: string,
    @Body() body: ApproveAdvanceSalaryDto,
    @Req() req,
  ) {
    return this.service.reject(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('advance-salaries/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete advance salary request' })
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
