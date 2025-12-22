import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { IncrementService } from './increment.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BulkCreateIncrementDto, UpdateIncrementDto } from './dto/create-increment.dto';

@Controller('api')
export class IncrementController {
  constructor(private service: IncrementService) {}

  @Get('increments')
  @UseGuards(JwtAuthGuard)
  async list(
    @Query('employeeId') employeeId?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.service.list({
      employeeId,
      month,
      year,
    });
  }

  @Get('increments/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('increments/bulk')
  @UseGuards(JwtAuthGuard)
  async bulkCreate(@Body() body: BulkCreateIncrementDto, @Req() req) {
    return this.service.bulkCreate(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('increments/:id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() body: UpdateIncrementDto, @Req() req) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('increments/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}

