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
import { AttendanceExemptionService } from './attendance-exemption.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateAttendanceExemptionDto } from './dto/create-attendance-exemption.dto';
import { UpdateAttendanceExemptionDto } from './dto/update-attendance-exemption.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';

@ApiTags('Attendance Exemption')
@Controller('api')
export class AttendanceExemptionController {
  constructor(private service: AttendanceExemptionService) {}

  @Get('attendance-exemptions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List attendance exemptions' })
  async list() {
    return this.service.list();
  }

  @Get('attendance-exemptions/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get attendance exemption by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('attendance-exemptions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create attendance exemption' })
  async create(@Body() body: CreateAttendanceExemptionDto, @Req() req: any) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('attendance-exemptions/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update attendance exemption' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateAttendanceExemptionDto,
    @Req() req: any,
  ) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('attendance-exemptions/:id/approve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve attendance exemption' })
  async approve(@Param('id') id: string, @Req() req: any) {
    return this.service.approve(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('attendance-exemptions/:id/approve-level/:level')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve attendance exemption by approval level' })
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

  @Put('attendance-exemptions/:id/reject')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject attendance exemption' })
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

  @Put('attendance-exemptions/:id/reject-level/:level')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject attendance exemption by approval level' })
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

  @Delete('attendance-exemptions/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete attendance exemption' })
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
