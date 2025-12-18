import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { WorkingHoursPolicyService } from './working-hours-policy.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'

@Controller('api')
export class WorkingHoursPolicyController {
  constructor(private service: WorkingHoursPolicyService) {}

  @Get('working-hours-policies')
  @UseGuards(JwtAuthGuard)
  async list() {
    return this.service.list()
  }

  @Get('working-hours-policies/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('working-hours-policies')
  @UseGuards(JwtAuthGuard)
  async create(@Body() body: any, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('working-hours-policies/:id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() body: any, @Req() req) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('working-hours-policies/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('working-hours-policies/:id/set-default')
  @UseGuards(JwtAuthGuard)
  async setAsDefault(@Param('id') id: string, @Req() req) {
    return this.service.setAsDefault(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  // ==================== Policy Assignments ====================

  @Get('working-hours-policy-assignments')
  @UseGuards(JwtAuthGuard)
  async listAssignments(
    @Query('employeeId') employeeId?: string,
    @Query('policyId') policyId?: string,
  ) {
    return this.service.listAssignments({ employeeId, policyId })
  }

  @Get('working-hours-policy-assignments/:id')
  @UseGuards(JwtAuthGuard)
  async getAssignment(@Param('id') id: string) {
    return this.service.getAssignment(id)
  }

  @Get('employees/:employeeId/policy-assignments')
  @UseGuards(JwtAuthGuard)
  async getEmployeeAssignments(@Param('employeeId') employeeId: string) {
    return this.service.getEmployeeAssignments(employeeId)
  }

  @Post('working-hours-policy-assignments')
  @UseGuards(JwtAuthGuard)
  async createAssignment(@Body() body: any, @Req() req) {
    return this.service.createAssignment(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('working-hours-policy-assignments/:id')
  @UseGuards(JwtAuthGuard)
  async updateAssignment(@Param('id') id: string, @Body() body: any, @Req() req) {
    return this.service.updateAssignment(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('working-hours-policy-assignments/:id')
  @UseGuards(JwtAuthGuard)
  async removeAssignment(@Param('id') id: string, @Req() req) {
    return this.service.removeAssignment(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
}
