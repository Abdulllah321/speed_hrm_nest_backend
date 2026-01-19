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
  ApiBody,
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

  @Put('overtime-requests/:id/approve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve overtime request' })
  async approve(@Param('id') id: string, @Req() req: any) {
    return this.service.approve(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('overtime-requests/:id/approve-level/:level')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve overtime request by approval level' })
  async approveLevel(
    @Param('id') id: string,
    @Param('level') level: string,
    @Req() req: any,
  ) {
    const levelNumber = Number(level);
    return this.service.approveLevel(id, levelNumber as 1 | 2, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('overtime-requests/:id/reject')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject overtime request' })
  @ApiBody({
    schema: { type: 'object', properties: { remarks: { type: 'string' } } },
  })
  async reject(
    @Param('id') id: string,
    @Body() body: { remarks?: string },
    @Req() req: any,
  ) {
    return this.service.reject(id, body.remarks || '', {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('overtime-requests/:id/reject-level/:level')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject overtime request by approval level' })
  @ApiBody({
    schema: { type: 'object', properties: { remarks: { type: 'string' } } },
  })
  async rejectLevel(
    @Param('id') id: string,
    @Param('level') level: string,
    @Body() body: { remarks?: string },
    @Req() req: any,
  ) {
    const levelNumber = Number(level);
    return this.service.rejectLevel(
      id,
      levelNumber as 1 | 2,
      body.remarks || '',
      {
        userId: req.user?.userId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    );
  }
}
