import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { LeaveApplicationService } from './leave-application.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateLeaveApplicationDto } from './dto/create-leave-application.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';

@ApiTags('Leave Application')
@Controller('api')
export class LeaveApplicationController {
  constructor(private service: LeaveApplicationService) {}

  @Get('leave-applications/balance/:employeeId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get leave balance for employee' })
  async getLeaveBalance(@Param('employeeId') employeeId: string) {
    return this.service.getLeaveBalance(employeeId);
  }

  @Get('leave-applications')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List leave applications' })
  @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'subDepartmentId', required: false })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'fromDate', required: false })
  @ApiQuery({ name: 'toDate', required: false })
  async list(
    @Query('departmentId') departmentId?: string,
    @Query('subDepartmentId') subDepartmentId?: string,
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.service.list({
      departmentId,
      subDepartmentId,
      employeeId,
      status,
      fromDate,
      toDate,
    });
  }

  // Alias for leave-requests endpoint compatibility
  @Get('leave-requests')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List leave requests (Alias)' })
  @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'subDepartmentId', required: false })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'fromDate', required: false })
  @ApiQuery({ name: 'toDate', required: false })
  async listAsLeaveRequests(
    @Query('departmentId') departmentId?: string,
    @Query('subDepartmentId') subDepartmentId?: string,
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.service.list({
      departmentId,
      subDepartmentId,
      employeeId,
      status,
      fromDate,
      toDate,
    });
  }

  @Post('leave-applications')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create leave application' })
  async create(@Body() body: CreateLeaveApplicationDto, @Req() req: any) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('leave-applications/:id/approve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve leave application' })
  async approve(@Param('id') id: string, @Req() req: any) {
    return this.service.approve(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('leave-applications/:id/approve-level/:level')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve leave application by approval level' })
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

  @Put('leave-applications/:id/reject')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject leave application' })
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

  @Put('leave-applications/:id/reject-level/:level')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject leave application by approval level' })
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
