import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AdvanceSalaryService } from './advance-salary.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateAdvanceSalaryDto, UpdateAdvanceSalaryDto, ApproveAdvanceSalaryDto } from './dto/create-advance-salary.dto';

@Controller('api')
export class AdvanceSalaryController {
  constructor(private service: AdvanceSalaryService) {}

  @Get('advance-salaries')
  @UseGuards(JwtAuthGuard)
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
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('advance-salaries')
  @UseGuards(JwtAuthGuard)
  async create(@Body() body: CreateAdvanceSalaryDto, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('advance-salaries/:id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() body: UpdateAdvanceSalaryDto, @Req() req) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('advance-salaries/:id/approve')
  @UseGuards(JwtAuthGuard)
  async approve(@Param('id') id: string, @Body() body: ApproveAdvanceSalaryDto, @Req() req) {
    return this.service.approve(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('advance-salaries/:id/reject')
  @UseGuards(JwtAuthGuard)
  async reject(@Param('id') id: string, @Body() body: ApproveAdvanceSalaryDto, @Req() req) {
    return this.service.reject(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('advance-salaries/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
