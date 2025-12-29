import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RebateService } from './rebate.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CreateRebateDto,
  UpdateRebateDto,
} from './dto/create-rebate.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

@ApiTags('Rebate')
@Controller('api')
export class RebateController {
  constructor(private service: RebateService) {}

  @Get('rebates')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List rebates' })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'rebateNatureId', required: false })
  @ApiQuery({ name: 'monthYear', required: false, description: 'Format: YYYY-MM' })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'approved', 'rejected'] })
  @ApiResponse({ status: 200, description: 'Returns list of rebates' })
  async list(
    @Query('employeeId') employeeId?: string,
    @Query('rebateNatureId') rebateNatureId?: string,
    @Query('monthYear') monthYear?: string,
    @Query('status') status?: string,
  ) {
    const result = await this.service.list({
      employeeId,
      rebateNatureId,
      monthYear,
      status,
    });
    // Return data array directly for consistency with other endpoints
    return result.status ? result.data : [];
  }

  @Get('rebates/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get rebate by id' })
  @ApiResponse({ status: 200, description: 'Returns rebate details' })
  @ApiResponse({ status: 404, description: 'Rebate not found' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('rebates')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create rebate' })
  @ApiResponse({ status: 201, description: 'Rebate created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async create(@Body() body: CreateRebateDto, @Req() request: FastifyRequest) {
    return this.service.create(body, {
      userId: request.user?.userId,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Patch('rebates/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update rebate' })
  @ApiResponse({ status: 200, description: 'Rebate updated successfully' })
  @ApiResponse({ status: 404, description: 'Rebate not found' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateRebateDto,
    @Req() request: FastifyRequest,
  ) {
    return this.service.update(id, body, {
      userId: request.user?.userId,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Delete('rebates/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete rebate' })
  @ApiResponse({ status: 200, description: 'Rebate deleted successfully' })
  @ApiResponse({ status: 404, description: 'Rebate not found' })
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}

