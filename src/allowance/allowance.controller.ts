import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AllowanceService } from './allowance.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateAllowanceDto, BulkCreateAllowanceDto, UpdateAllowanceDto } from './dto/create-allowance.dto';

@Controller('api')
export class AllowanceController {
  constructor(private service: AllowanceService) {}

  @Get('allowances')
  @UseGuards(JwtAuthGuard)
  async list(
    @Query('employeeId') employeeId?: string,
    @Query('allowanceHeadId') allowanceHeadId?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('status') status?: string,
  ) {
    return this.service.list({
      employeeId,
      allowanceHeadId,
      month,
      year,
      status,
    });
  }

  @Get('allowances/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('allowances')
  @UseGuards(JwtAuthGuard)
  async create(@Body() body: CreateAllowanceDto, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('allowances/bulk')
  @UseGuards(JwtAuthGuard)
  async bulkCreate(@Body() body: BulkCreateAllowanceDto, @Req() req) {
    return this.service.bulkCreate(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('allowances/:id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() body: UpdateAllowanceDto, @Req() req) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('allowances/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('allowances/bulk')
  @UseGuards(JwtAuthGuard)
  async bulkDelete(@Body() body: { ids: string[] }, @Req() req) {
    return this.service.bulkDelete(body.ids, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
