import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { KpiService } from './kpi.service';
import { KpiDashboardService } from './kpi-dashboard.service';
import { KpiApprovalService } from './kpi-approval.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CreateKpiTemplateDto, UpdateKpiTemplateDto, CreateKpiReviewDto, UpdateKpiReviewDto } from './dto/kpi.dto';
import { IsOptional, IsString, IsArray } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

class ApproveReviewDto {
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
class RejectReviewDto {
  @ApiPropertyOptional() @IsOptional() @IsString() rejectionReason: string;
}
class BulkApproveDto {
  @ApiPropertyOptional() @IsOptional() @IsArray() employeeIds?: string[];
}

@ApiTags('KPI')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api')
export class KpiController {
  constructor(
    private service: KpiService,
    private dashboard: KpiDashboardService,
    private approval: KpiApprovalService,
  ) {}

  // ─── Templates ───────────────────────────────────────────────────────────────

  @Get('kpi/templates')
  @Permissions('hr.kpi.read')
  @ApiOperation({ summary: 'List KPI templates' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'status', required: false })
  listTemplates(@Query('category') category?: string, @Query('status') status?: string) {
    return this.service.listTemplates({ category, status });
  }

  @Get('kpi/templates/:id')
  @Permissions('hr.kpi.read')
  @ApiOperation({ summary: 'Get KPI template by id' })
  getTemplate(@Param('id') id: string) {
    return this.service.getTemplate(id);
  }

  @Post('kpi/templates')
  @Permissions('hr.kpi.create')
  @ApiOperation({ summary: 'Create KPI template' })
  createTemplate(@Body() body: CreateKpiTemplateDto, @Req() req) {
    return this.service.createTemplate(body, { userId: req.user?.userId, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Put('kpi/templates/:id')
  @Permissions('hr.kpi.update')
  @ApiOperation({ summary: 'Update KPI template' })
  updateTemplate(@Param('id') id: string, @Body() body: UpdateKpiTemplateDto, @Req() req) {
    return this.service.updateTemplate(id, body, { userId: req.user?.userId, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Delete('kpi/templates/:id')
  @Permissions('hr.kpi.delete')
  @ApiOperation({ summary: 'Delete KPI template' })
  deleteTemplate(@Param('id') id: string, @Req() req) {
    return this.service.deleteTemplate(id, { userId: req.user?.userId, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  // ─── Reviews ─────────────────────────────────────────────────────────────────

  @Get('kpi/reviews')
  @Permissions('hr.kpi.read')
  @ApiOperation({ summary: 'List KPI reviews' })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'kpiTemplateId', required: false })
  @ApiQuery({ name: 'period', required: false })
  @ApiQuery({ name: 'periodType', required: false })
  @ApiQuery({ name: 'status', required: false })
  listReviews(
    @Query('employeeId') employeeId?: string,
    @Query('kpiTemplateId') kpiTemplateId?: string,
    @Query('period') period?: string,
    @Query('periodType') periodType?: string,
    @Query('status') status?: string,
  ) {
    return this.service.listReviews({ employeeId, kpiTemplateId, period, periodType, status });
  }

  @Get('kpi/reviews/:id')
  @Permissions('hr.kpi.read')
  @ApiOperation({ summary: 'Get KPI review by id' })
  getReview(@Param('id') id: string) {
    return this.service.getReview(id);
  }

  @Post('kpi/reviews')
  @Permissions('hr.kpi.create')
  @ApiOperation({ summary: 'Create KPI review' })
  createReview(@Body() body: CreateKpiReviewDto, @Req() req) {
    return this.service.createReview(body, { userId: req.user?.userId, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Put('kpi/reviews/:id')
  @Permissions('hr.kpi.update')
  @ApiOperation({ summary: 'Update KPI review' })
  updateReview(@Param('id') id: string, @Body() body: UpdateKpiReviewDto, @Req() req) {
    return this.service.updateReview(id, body, { userId: req.user?.userId, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Delete('kpi/reviews/:id')
  @Permissions('hr.kpi.delete')
  @ApiOperation({ summary: 'Delete KPI review' })
  deleteReview(@Param('id') id: string, @Req() req) {
    return this.service.deleteReview(id, { userId: req.user?.userId, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  // ─── Auto-Compute ─────────────────────────────────────────────────────────────

  @Post('kpi/auto-populate')
  @Permissions('hr.kpi.create')
  @ApiOperation({ summary: 'Auto-populate KPI reviews from system data for an employee + period' })
  @ApiQuery({ name: 'employeeId', required: true })
  @ApiQuery({ name: 'period', required: true, description: 'e.g. 2026-Q1 or 2026-04' })
  @ApiQuery({ name: 'periodType', required: true, enum: ['monthly', 'quarterly', 'yearly'] })
  autoPopulate(
    @Query('employeeId') employeeId: string,
    @Query('period') period: string,
    @Query('periodType') periodType: string,
    @Req() req,
  ) {
    return this.service.autoPopulate(employeeId, period, periodType, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('kpi/employee/:id/summary')
  @Permissions('hr.kpi.read')
  @ApiOperation({ summary: 'Get full KPI summary for an employee (saved reviews + live metrics)' })
  @ApiQuery({ name: 'period', required: true })
  @ApiQuery({ name: 'periodType', required: true, enum: ['monthly', 'quarterly', 'yearly'] })
  getEmployeeSummary(
    @Param('id') id: string,
    @Query('period') period: string,
    @Query('periodType') periodType: string,
  ) {
    return this.service.getEmployeeSummary(id, period, periodType);
  }

  // ─── Org Dashboard ────────────────────────────────────────────────────────────

  @Get('kpi/dashboard')
  @Permissions('hr.kpi.read')
  @ApiOperation({ summary: 'Org-wide KPI dashboard aggregated by department, category, and performers' })
  @ApiQuery({ name: 'period', required: true })
  @ApiQuery({ name: 'periodType', required: true, enum: ['monthly', 'quarterly', 'yearly'] })
  getOrgDashboard(
    @Query('period') period: string,
    @Query('periodType') periodType: string,
  ) {
    return this.dashboard.getOrgDashboard(period, periodType);
  }

  @Get('kpi/export')
  @Permissions('hr.kpi.read')
  @ApiOperation({ summary: 'Export all KPI reviews for a period as flat JSON (for CSV)' })
  @ApiQuery({ name: 'period', required: true })
  exportReviews(@Query('period') period: string) {
    return this.dashboard.exportReviews(period);
  }

  // ─── Approval Workflow ────────────────────────────────────────────────────────

  @Get('kpi/approvals/pending')
  @Permissions('hr.kpi.approve')
  @ApiOperation({ summary: 'List KPI reviews pending approval (status = submitted)' })
  @ApiQuery({ name: 'period', required: false })
  @ApiQuery({ name: 'departmentId', required: false })
  listPendingApproval(
    @Query('period') period?: string,
    @Query('departmentId') departmentId?: string,
  ) {
    return this.approval.listPendingApproval({ period, departmentId });
  }

  @Post('kpi/reviews/:id/submit')
  @Permissions('hr.kpi.update')
  @ApiOperation({ summary: 'Submit a KPI review for manager approval (pending → submitted)' })
  submitReview(@Param('id') id: string, @Req() req) {
    return this.approval.submit(id, { userId: req.user?.userId, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Post('kpi/reviews/:id/approve')
  @Permissions('hr.kpi.approve')
  @ApiOperation({ summary: 'Approve a submitted KPI review (submitted → approved)' })
  approveReview(@Param('id') id: string, @Body() body: ApproveReviewDto, @Req() req) {
    return this.approval.approve(id, body.notes, { userId: req.user?.userId, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Post('kpi/reviews/:id/reject')
  @Permissions('hr.kpi.approve')
  @ApiOperation({ summary: 'Reject a submitted KPI review (submitted → rejected)' })
  rejectReview(@Param('id') id: string, @Body() body: RejectReviewDto, @Req() req) {
    return this.approval.reject(id, body.rejectionReason, { userId: req.user?.userId, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Post('kpi/approvals/bulk-approve')
  @Permissions('hr.kpi.approve')
  @ApiOperation({ summary: 'Bulk approve all submitted reviews for a period' })
  @ApiQuery({ name: 'period', required: true })
  bulkApprove(@Query('period') period: string, @Body() body: BulkApproveDto, @Req() req) {
    return this.approval.bulkApprove(period, body.employeeIds, { userId: req.user?.userId, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }
}
