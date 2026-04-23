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
  Res,
  UseGuards,
  Sse,
  MessageEvent,
  Logger
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { FastifyRequest } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Observable } from 'rxjs';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiQuery,
  ApiConsumes
} from '@nestjs/swagger';
import {
  CreateAttendanceDto,
  UpdateAttendanceDto,
} from './dto/create-attendance.dto';
import { AttendanceBulkUploadService } from './attendance-bulk-upload.service';
import { AttendanceUploadEventsService } from './attendance-upload-events.service';

@ApiTags('Attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api')
export class AttendanceController {
  private readonly logger = new Logger(AttendanceController.name);

  constructor(
    private service: AttendanceService,
    private bulkUploadService: AttendanceBulkUploadService,
    private eventsService: AttendanceUploadEventsService
  ) {}

  @Get('attendances')
  @Permissions('hr.attendance.view')
  @ApiOperation({ summary: 'List attendances' })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'status', required: false })
  async list(
    @Query('employeeId') employeeId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('status') status?: string,
  ) {
    return this.service.list({
      employeeId,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      status,
    });
  }

  @Get('attendances/summary')
  @Permissions('hr.attendance.summary')
  @ApiOperation({ summary: 'Get attendance summary' })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'subDepartmentId', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  async getSummary(
    @Query('employeeId') employeeId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('subDepartmentId') subDepartmentId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.getProgressSummary({
      employeeId,
      departmentId,
      subDepartmentId,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
    });
  }

  @Get('attendances/:id')
  @Permissions('hr.attendance.view')
  @ApiOperation({ summary: 'Get attendance by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('attendances')
  @Permissions('hr.attendance.create')
  @ApiOperation({ summary: 'Create attendance' })
  async create(@Body() body: CreateAttendanceDto, @Req() req: any) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('attendances/date-range')
  @Permissions('hr.attendance.create')
  @ApiOperation({ summary: 'Create attendance for date range' })
  async createForDateRange(@Body() body: any, @Req() req: any) {
    return this.service.createForDateRange(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('attendances/:id')
  @Permissions('hr.attendance.update')
  @ApiOperation({ summary: 'Update attendance' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateAttendanceDto,
    @Req() req: any,
  ) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('attendances/:id')
  @Permissions('hr.attendance.delete')
  @ApiOperation({ summary: 'Delete attendance' })
  async delete(@Param('id') id: string, @Req() req: any) {
    return this.service.delete(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('attendances/import-csv')
  @Permissions('hr.attendance.create')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOperation({ summary: 'Initiate bulk attendance validation' })
  async importCsv(@Req() request: FastifyRequest) {
    const data = await request.file();
    if (!data) {
      return { status: false, message: 'No file provided' };
    }

    const fileExtension = path.extname(data.filename).toLowerCase();
    if (fileExtension !== '.csv' && fileExtension !== '.xlsx') {
      return {
        status: false,
        message: 'Invalid file format. Please upload a CSV (.csv) or Excel (.xlsx) file',
      };
    }

    const user = request.user as any;
    const userId = user?.userId || user?.sub || user?.id || 'system';

    const fileBuffer = await data.toBuffer();
    return this.bulkUploadService.initiateValidation(fileBuffer, data.filename, userId);
  }

  @Get('attendances/bulk-upload/:uploadId/status')
  @Permissions('hr.attendance.read')
  @ApiOperation({ summary: 'Get bulk upload status' })
  async getBulkUploadStatus(@Param('uploadId') uploadId: string) {
    const status = await this.bulkUploadService.getUploadStatus(uploadId);
    return {
      status: true,
      data: status,
    };
  }

  @Post('attendances/bulk-upload/:uploadId/confirm')
  @Permissions('hr.attendance.create')
  @ApiOperation({ summary: 'Confirm and start attendance import' })
  async confirmBulkUpload(@Param('uploadId') uploadId: string, @Req() req: FastifyRequest) {
    const user = req.user as any;
    const userId = user?.userId || user?.sub || user?.id || 'system';
    return this.bulkUploadService.confirmUpload(uploadId, userId);
  }

  @Get('attendances/bulk-upload/:uploadId/errors/stream')
  @Permissions('hr.attendance.read')
  @ApiOperation({ summary: 'Stream bulk upload error report' })
  async streamBulkUploadErrors(@Param('uploadId') uploadId: string, @Res() res: any) {
    return this.bulkUploadService.streamErrorReport(uploadId, res);
  }

  @Get('attendances/import-template')
  @Permissions('hr.attendance.read')
  @ApiOperation({ summary: 'Download attendance import template' })
  async downloadTemplate(@Res() res: any) {
    try {
      const buffer = await this.bulkUploadService.generateTemplate();
      res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.header('Content-Disposition', 'attachment; filename=attendance_import_template.xlsx');
      res.send(buffer);
    } catch (error) {
      this.logger.error(`Failed to generate template: ${error.message}`);
      res.status(500).send({ status: false, message: 'Failed to generate template' });
    }
  }

  @Sse('attendances/bulk-upload/:uploadId/events')
  @Permissions('hr.attendance.read')
  @ApiOperation({ summary: 'Stream bulk upload real-time events (SSE)' })
  streamEvents(@Param('uploadId') uploadId: string): Observable<MessageEvent> {
    return this.eventsService.subscribe(uploadId);
  }
}
