import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { OvertimeRequestService } from './overtime-request.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateOvertimeRequestDto, UpdateOvertimeRequestDto } from './dto/create-overtime-request.dto';

@Controller('api')
export class OvertimeRequestController {
  constructor(private service: OvertimeRequestService) {}

  @Get('overtime-requests')
  @UseGuards(JwtAuthGuard)
  async list(
    @Query('employeeId') employeeId?: string,
    @Query('overtimeType') overtimeType?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.service.list({
      employeeId,
      overtimeType,
      status,
      startDate,
      endDate,
    });
  }

  @Get('overtime-requests/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('overtime-requests')
  @UseGuards(JwtAuthGuard)
  async create(@Body() body: CreateOvertimeRequestDto, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('overtime-requests/:id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() body: UpdateOvertimeRequestDto, @Req() req) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('overtime-requests/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}

