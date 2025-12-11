import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { LeavesPolicyService } from './leaves-policy.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'

@Controller('api')
export class LeavesPolicyController {
  constructor(private service: LeavesPolicyService) {}

  @Get('leaves-policies')
  @UseGuards(JwtAuthGuard)
  async list() {
    return this.service.list()
  }

  @Get('leaves-policies/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('leaves-policies')
  @UseGuards(JwtAuthGuard)
  async create(
    @Body()
    body: {
      name: string
      details?: string
      policyDateFrom?: string
      policyDateTill?: string
      fullDayDeductionRate?: number
      halfDayDeductionRate?: number
      shortLeaveDeductionRate?: number
      status?: string
      isDefault?: boolean
      leaveTypes?: { leaveTypeId: string; numberOfLeaves: number }[]
    },
    @Req() req: any,
  ) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Post('leaves-policies/bulk')
  @UseGuards(JwtAuthGuard)
  async createBulk(
    @Body() body: { items: { name: string; details?: string; status?: string }[] },
    @Req() req: any,
  ) {
    return this.service.createBulk(body.items ?? [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('leaves-policies/:id')
  @UseGuards(JwtAuthGuard)
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string
      details?: string
      policyDateFrom?: string
      policyDateTill?: string
      fullDayDeductionRate?: number
      halfDayDeductionRate?: number
      shortLeaveDeductionRate?: number
      status?: string
      isDefault?: boolean
      leaveTypes?: { leaveTypeId: string; numberOfLeaves: number }[]
    },
    @Req() req: any,
  ) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('leaves-policies/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('leaves-policies/bulk')
  @UseGuards(JwtAuthGuard)
  async updateBulk(
    @Body() body: { items: { id: string; name: string; details?: string; status?: string }[] },
    @Req() req: any,
  ) {
    return this.service.updateBulk(body.items ?? [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('leaves-policies/bulk')
  @UseGuards(JwtAuthGuard)
  async removeBulk(@Body() body: { ids: string[] }, @Req() req: any) {
    return this.service.removeBulk(body.ids ?? [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('leaves-policies/:id/set-default')
  @UseGuards(JwtAuthGuard)
  async setAsDefault(@Param('id') id: string, @Req() req: any) {
    return this.service.setAsDefault(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
}
