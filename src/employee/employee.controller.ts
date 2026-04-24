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
  Logger,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { EmployeeService } from './employee.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import type { FastifyRequest } from 'fastify';
import * as path from 'path';
import * as fs from 'fs';
import { Observable } from 'rxjs';

import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import {
  CreateEmployeeDto,
  UpdateEmployeeDto,
} from './dto/create-employee.dto';
import { EmployeeBulkUploadService } from './employee-bulk-upload.service';
import { EmployeeUploadEventsService } from './employee-upload-events.service';

@ApiTags('Employee')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api')
export class EmployeeController {
  private readonly logger = new Logger(EmployeeController.name);

  constructor(
    private service: EmployeeService,
    private bulkUploadService: EmployeeBulkUploadService,
    private eventsService: EmployeeUploadEventsService,
  ) { }

  @Get('employees')
  @Permissions('hr.employee.read', 'hr.leave.selectEmployee')
  @ApiOperation({ summary: 'List all employees' })
  async list(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.service.list({ page, limit, search });
  }

  @Get('employees/for-attendance')
  @Permissions('hr.employee.read', 'hr.leave.selectEmployee')
  @ApiOperation({ summary: 'List employees for attendance management' })
  async listForAttendance(
    @Query('departmentId') departmentId?: string,
    @Query('subDepartmentId') subDepartmentId?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.service.listForAttendance({
      departmentId,
      subDepartmentId,
      page,
      limit,
      search,
    });
  }

  @Get('employees/dropdown')
  @Permissions('hr.employee.read', 'hr.leave.selectEmployee')
  @ApiOperation({ summary: 'List employees for dropdown' })
  async listForDropdown(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.service.listForDropdown({ page, limit, search });
  }

  @Get('employees/rejoin/search')
  @Permissions('hr.employee.read')
  @ApiOperation({ summary: 'Search employee for rejoin' })
  async searchForRejoin(@Query('cnic') cnic: string) {
    if (!cnic) {
      return { status: false, message: 'CNIC is required' };
    }
    return this.service.findByCnicForRejoin(cnic);
  }

  @Post('employees/rejoin')
  @Permissions('hr.employee.create')
  @ApiOperation({ summary: 'Rejoin employee' })
  async rejoinEmployee(
    @Body() body: Record<string, unknown>,
    @Req() req: FastifyRequest,
  ) {
    const cnic = body.cnic as string | undefined;
    if (!cnic) {
      return { status: false, message: 'CNIC is required' };
    }
    return this.service.rejoinEmployee(cnic, body, {
      userId: (req.user as any)?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('employees/:id/rejoining-history')
  @Permissions('hr.employee.read')
  @ApiOperation({ summary: 'Get rejoining history' })
  async getRejoiningHistory(@Param('id') id: string) {
    return this.service.getRejoiningHistory(id);
  }

  @Get('employees/:id/historical-state')
  @Permissions('hr.employee.read')
  @ApiOperation({ summary: 'Get historical state' })
  async getHistoricalState(
    @Param('id') id: string,
    @Query('beforeDate') beforeDate?: string,
  ) {
    const date = beforeDate ? new Date(beforeDate) : undefined;
    return this.service.getHistoricalState(id, date);
  }

  @Get('employees/:id')
  @ApiOperation({ summary: 'Get employee details' })
  async get(
    @Param('id') id: string,
    @Query('includeHistory') includeHistory?: string,
  ) {
    return this.service.get(id, includeHistory === 'true');
  }

  @Post('employees')
  @Permissions('hr.employee.create')
  @ApiOperation({ summary: 'Create employee' })
  async create(@Body() body: CreateEmployeeDto, @Req() req: FastifyRequest) {
    return this.service.create(body, {
      userId: (req.user as any)?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('employees/:id')
  @Permissions('hr.employee.update')
  @ApiOperation({ summary: 'Update employee' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateEmployeeDto,
    @Req() req: FastifyRequest,
  ) {
    return this.service.update(id, body as any, {
      userId: (req.user as any)?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('employees/:id')
  @Permissions('hr.employee.delete')
  @ApiOperation({ summary: 'Delete employee' })
  async remove(@Param('id') id: string, @Req() req: FastifyRequest) {
    return this.service.remove(id, {
      userId: (req.user as any)?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('employees/import-csv')
  @Permissions('hr.employee.create')
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
  @ApiOperation({ summary: 'Initiate bulk employee validation' })
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

  @Get('employees/bulk-upload/:uploadId/status')
  @Permissions('hr.employee.read')
  @ApiOperation({ summary: 'Get bulk upload status' })
  async getBulkUploadStatus(@Param('uploadId') uploadId: string) {
    const status = await this.bulkUploadService.getUploadStatus(uploadId);
    return {
      status: true,
      data: status,
    };
  }

  @Post('employees/bulk-upload/:uploadId/confirm')
  @Permissions('hr.employee.create')
  @ApiOperation({ summary: 'Confirm and start employee import' })
  async confirmBulkUpload(@Param('uploadId') uploadId: string, @Req() req: FastifyRequest) {
    const user = req.user as any;
    const userId = user?.userId || user?.sub || user?.id || 'system';
    return this.bulkUploadService.confirmUpload(uploadId, userId);
  }

  @Get('employees/bulk-upload/:uploadId/errors/stream')
  @Permissions('hr.employee.read')
  @ApiOperation({ summary: 'Stream bulk upload error report' })
  async streamBulkUploadErrors(@Param('uploadId') uploadId: string, @Res() res: any) {
    return this.bulkUploadService.streamErrorReport(uploadId, res);
  }

  @Get('employees/import-template')
  @Permissions('hr.employee.read')
  @ApiOperation({ summary: 'Download employee import template' })
  async downloadTemplate(@Res() res: any) {
    try {
      const buffer = await this.bulkUploadService.generateTemplate();
      res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.header('Content-Disposition', 'attachment; filename=employee_import_template.xlsx');
      res.send(buffer);
    } catch (error) {
      this.logger.error(`Failed to generate template: ${error.message}`);
      res.status(500).send({ status: false, message: 'Failed to generate template' });
    }
  }

  @Sse('employees/bulk-upload/:uploadId/events')
  @Permissions('hr.employee.read')
  @ApiOperation({ summary: 'Stream bulk upload real-time events (SSE)' })
  streamEvents(@Param('uploadId') uploadId: string): Observable<MessageEvent> {
    return this.eventsService.subscribe(uploadId);
  }
}
