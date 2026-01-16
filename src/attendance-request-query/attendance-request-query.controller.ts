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
