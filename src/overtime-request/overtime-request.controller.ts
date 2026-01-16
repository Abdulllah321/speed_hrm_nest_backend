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
import { OvertimeRequestService } from './overtime-request.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CreateOvertimeRequestDto,
  UpdateOvertimeRequestDto,
} from './dto/create-overtime-request.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';

@ApiTags('Overtime Request')
@Controller('api')
export class OvertimeRequestController {
  constructor(private service: OvertimeRequestService) {}

  @Get('overtime-requests')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List overtime requests' })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'overtimeType', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get overtime request by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('overtime-requests')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create overtime request' })
  async create(@Body() body: CreateOvertimeRequestDto, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('overtime-requests/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update overtime request' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateOvertimeRequestDto,
    @Req() req,
  ) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('overtime-requests/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete overtime request' })
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
