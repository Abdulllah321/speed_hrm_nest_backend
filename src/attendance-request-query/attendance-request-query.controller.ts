import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AttendanceRequestQueryService } from './attendance-request-query.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateAttendanceRequestQueryDto } from './dto/create-attendance-request-query.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';

@ApiTags('Attendance Request Query')
@Controller('api')
export class AttendanceRequestQueryController {
  constructor(private service: AttendanceRequestQueryService) {}

  @Get('attendance-request-queries')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List attendance request queries' })
  async list() {
    return this.service.list();
  }

  @Get('attendance-request-queries/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get attendance request query by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('attendance-request-queries')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create attendance request query' })
  async create(@Body() body: CreateAttendanceRequestQueryDto, @Req() req: any) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('attendance-request-queries/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update attendance request query' })
  async update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('attendance-request-queries/:id/approve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve attendance request query' })
  async approve(@Param('id') id: string, @Req() req: any) {
    return this.service.approve(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('attendance-request-queries/:id/approve-level/:level')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Approve attendance request query by approval level',
  })
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

  @Put('attendance-request-queries/:id/reject')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject attendance request query' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        rejectionReason: { type: 'string' },
      },
    },
  })
  async reject(
    @Param('id') id: string,
    @Body() body: { rejectionReason?: string },
    @Req() req: any,
  ) {
    return this.service.reject(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('attendance-request-queries/:id/reject-level/:level')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reject attendance request query by approval level',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        rejectionReason: { type: 'string' },
      },
    },
  })
  async rejectLevel(
    @Param('id') id: string,
    @Param('level') level: string,
    @Body() body: { rejectionReason?: string },
    @Req() req: any,
  ) {
    const levelNumber = Number(level);
    return this.service.rejectLevel(id, levelNumber as 1 | 2, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('attendance-request-queries/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete attendance request query' })
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
