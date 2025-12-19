import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { DeductionService } from './deduction.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateDeductionDto, BulkCreateDeductionDto, UpdateDeductionDto } from './dto/create-deduction.dto';

@Controller('api')
export class DeductionController {
  constructor(private service: DeductionService) {}

  @Get('deductions')
  @UseGuards(JwtAuthGuard)
  async list(
    @Query('employeeId') employeeId?: string,
    @Query('deductionHeadId') deductionHeadId?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('status') status?: string,
  ) {
    return this.service.list({
      employeeId,
      deductionHeadId,
      month,
      year,
      status,
    });
  }

  @Get('deductions/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('deductions')
  @UseGuards(JwtAuthGuard)
  async create(@Body() body: CreateDeductionDto, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('deductions/bulk')
  @UseGuards(JwtAuthGuard)
  async bulkCreate(@Body() body: BulkCreateDeductionDto, @Req() req) {
    return this.service.bulkCreate(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('deductions/:id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() body: UpdateDeductionDto, @Req() req) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('deductions/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('deductions/bulk')
  @UseGuards(JwtAuthGuard)
  async bulkDelete(@Body() body: { ids: string[] }, @Req() req) {
    return this.service.bulkDelete(body.ids, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('deduction-heads')
  @UseGuards(JwtAuthGuard)
  async listDeductionHeads(@Query('status') status?: string) {
    return this.service.listDeductionHeads(status);
  }

  @Get('deduction-heads/:id')
  @UseGuards(JwtAuthGuard)
  async getDeductionHead(@Param('id') id: string) {
    return this.service.getDeductionHead(id);
  }
}
