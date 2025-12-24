import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { WorkingHoursPolicyService } from './working-hours-policy.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger'
import { CreateWorkingHoursPolicyDto, UpdateWorkingHoursPolicyDto } from './dto/working-hours-policy.dto'

@ApiTags('Working Hours Policy')
@Controller('api')
export class WorkingHoursPolicyController {
  constructor(private service: WorkingHoursPolicyService) {}

  @Get('working-hours-policies')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all working hours policies' })
  async list() {
    return this.service.list()
  }

  @Get('working-hours-policies/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get working hours policy by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('working-hours-policies')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create working hours policy' })
  async create(@Body() body: CreateWorkingHoursPolicyDto, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('working-hours-policies/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update working hours policy' })
  async update(@Param('id') id: string, @Body() body: UpdateWorkingHoursPolicyDto, @Req() req) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('working-hours-policies/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete working hours policy' })
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('working-hours-policies/:id/set-default')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set working hours policy as default' })
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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List policy assignments' })
  async listAssignments(
    @Query('employeeId') employeeId?: string,
    @Query('policyId') policyId?: string,
  ) {
    return this.service.listAssignments({ employeeId, policyId })
  }

  @Get('working-hours-policy-assignments/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get policy assignment by id' })
  async getAssignment(@Param('id') id: string) {
    return this.service.getAssignment(id)
  }

  @Get('employees/:employeeId/policy-assignments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get policy assignments for employee' })
  async getEmployeeAssignments(@Param('employeeId') employeeId: string) {
    return this.service.getEmployeeAssignments(employeeId)
  }

  @Post('working-hours-policy-assignments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create policy assignment' })
  @ApiBody({ schema: { type: 'object', properties: { employeeId: { type: 'string' }, policyId: { type: 'string' }, effectDate: { type: 'string' } } } })
  async createAssignment(@Body() body: any, @Req() req) {
    return this.service.createAssignment(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('working-hours-policy-assignments/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update policy assignment' })
  @ApiBody({ schema: { type: 'object', properties: { employeeId: { type: 'string' }, policyId: { type: 'string' }, effectDate: { type: 'string' } } } })
  async updateAssignment(@Param('id') id: string, @Body() body: any, @Req() req) {
    return this.service.updateAssignment(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('working-hours-policy-assignments/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete policy assignment' })
  async removeAssignment(@Param('id') id: string, @Req() req) {
    return this.service.removeAssignment(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
}
