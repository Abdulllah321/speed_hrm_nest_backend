import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { IncrementService } from './increment.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BulkCreateIncrementDto, UpdateIncrementDto } from './dto/create-increment.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody, ApiQuery } from '@nestjs/swagger';

@ApiTags('Increment')
@Controller('api')
export class IncrementController {
  constructor(private service: IncrementService) {}

  @Get('increments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List increments' })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'month', required: false })
  @ApiQuery({ name: 'year', required: false })
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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get increment by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('increments/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create increments in bulk' })
  async bulkCreate(@Body() body: BulkCreateIncrementDto, @Req() req) {
    return this.service.bulkCreate(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('increments/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update increment' })
  async update(@Param('id') id: string, @Body() body: UpdateIncrementDto, @Req() req) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('increments/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete increment' })
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}

