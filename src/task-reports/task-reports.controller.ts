import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { TaskReportsService } from './task-reports.service';

@ApiTags('Task Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/task-reports')
export class TaskReportsController {
  constructor(private service: TaskReportsService) {}

  @Get('employee-summary')
  @Permissions('task.report.read')
  @ApiOperation({ summary: 'Employee task summary for a period' })
  @ApiQuery({ name: 'employeeId', required: true })
  @ApiQuery({ name: 'period', required: true, description: '2026-04 | 2026-Q1 | 2026' })
  employeeSummary(@Query('employeeId') employeeId: string, @Query('period') period: string) {
    return this.service.employeeSummary(employeeId, period);
  }

  @Get('project-summary')
  @Permissions('task.report.read')
  @ApiOperation({ summary: 'Project task summary' })
  @ApiQuery({ name: 'projectId', required: true })
  projectSummary(@Query('projectId') projectId: string) {
    return this.service.projectSummary(projectId);
  }

  @Get('department-summary')
  @Permissions('task.report.read')
  @ApiOperation({ summary: 'Department task summary for a period' })
  @ApiQuery({ name: 'departmentId', required: true })
  @ApiQuery({ name: 'period', required: true })
  departmentSummary(@Query('departmentId') departmentId: string, @Query('period') period: string) {
    return this.service.departmentSummary(departmentId, period);
  }

  @Get('export')
  @Permissions('task.report.read')
  @ApiOperation({ summary: 'Export project tasks as CSV' })
  @ApiQuery({ name: 'projectId', required: true })
  async exportCsv(@Query('projectId') projectId: string, @Res() res: FastifyReply) {
    const csv = await this.service.exportCsv(projectId);
    res
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', `attachment; filename="tasks-${projectId}.csv"`)
      .send(csv);
  }

  // ─── Dashboard Widgets ────────────────────────────────────────────────────────

  @Get('widgets/admin')
  @Permissions('task.manage-all')
  @ApiOperation({ summary: 'Admin dashboard task widgets' })
  adminWidgets() {
    return this.service.adminWidgets();
  }

  @Get('widgets/employee')
  @Permissions('task.read')
  @ApiOperation({ summary: 'Employee dashboard task widgets' })
  employeeWidgets(@Req() req) {
    const employeeId = req.user?.employeeId;
    if (!employeeId) return { status: false, message: 'Employee ID not found in token' };
    return this.service.employeeWidgets(employeeId);
  }
}
