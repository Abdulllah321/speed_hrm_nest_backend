import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { AllowanceHeadService } from './allowance-head.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'

@Controller('api')
export class AllowanceHeadController {
  constructor(private service: AllowanceHeadService) {}

  @Get('allowance-heads')
  @UseGuards(JwtAuthGuard)
  async list() {
    return this.service.list()
  }

  @Get('allowance-heads/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('allowance-heads')
  @UseGuards(JwtAuthGuard)
  async create(@Body() body: { name: string; status?: string }, @Req() req) {
    return this.service.create(body.name, body.status, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Post('allowance-heads/bulk')
  @UseGuards(JwtAuthGuard)
  async createBulk(@Body() body: { items: { name: string; status?: string }[] }, @Req() req) {
    return this.service.createBulk(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('allowance-heads/:id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() body: { name: string; status?: string }, @Req() req) {
    return this.service.update(id, body.name, body.status, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('allowance-heads/bulk')
  @UseGuards(JwtAuthGuard)
  async updateBulk(@Body() body: { items: { id: string; name: string; status?: string }[] }, @Req() req) {
    return this.service.updateBulk(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('allowance-heads/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('allowance-heads/bulk')
  @UseGuards(JwtAuthGuard)
  async removeBulk(@Body() body: { ids: string[] }, @Req() req) {
    return this.service.removeBulk(body.ids || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
}

