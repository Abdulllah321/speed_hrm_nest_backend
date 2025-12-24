import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { LeavesPolicyService } from './leaves-policy.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger'
import { CreateLeavesPolicyDto, UpdateLeavesPolicyDto } from './dto/leaves-policy.dto'

@ApiTags('Leaves Policy')
@Controller('api')
export class LeavesPolicyController {
  constructor(private service: LeavesPolicyService) {}

  @Get('leaves-policies')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all leaves policies' })
  async list() {
    return this.service.list()
  }

  @Get('leaves-policies/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get leaves policy by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('leaves-policies')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create leaves policy' })
  async create(
    @Body() body: CreateLeavesPolicyDto,
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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create leaves policies in bulk' })
  @ApiBody({ type: CreateLeavesPolicyDto, isArray: true })
  async createBulk(
    @Body() body: { items: CreateLeavesPolicyDto[] },
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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update leaves policy' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateLeavesPolicyDto,
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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete leaves policy' })
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('leaves-policies/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update leaves policies in bulk' })
  @ApiBody({ type: UpdateLeavesPolicyDto, isArray: true })
  async updateBulk(
    @Body() body: { items: UpdateLeavesPolicyDto[] },
    @Req() req: any,
  ) {
    return this.service.updateBulk((body.items as any) ?? [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('leaves-policies/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete leaves policies in bulk' })
  @ApiBody({ schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, example: ['uuid1', 'uuid2'] } } } })
  async removeBulk(@Body() body: { ids: string[] }, @Req() req: any) {
    return this.service.removeBulk(body.ids ?? [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('leaves-policies/:id/set-default')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set leaves policy as default' })
  async setAsDefault(@Param('id') id: string, @Req() req: any) {
    return this.service.setAsDefault(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
}
