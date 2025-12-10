import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { JobTypeService } from './job-type.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'

@Controller('api')
export class JobTypeController {
  constructor(private service: JobTypeService) {}

  @Get('job-types')
  @UseGuards(JwtAuthGuard)
  async list() {
    return this.service.list()
  }

  @Get('job-types/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('job-types')
  @UseGuards(JwtAuthGuard)
  async create(@Body() body: { name: string }, @Req() req) {
    return this.service.create(body.name, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Post('job-types/bulk')
  @UseGuards(JwtAuthGuard)
  async createBulk(@Body() body: { names: string[] }, @Req() req) {
    return this.service.createBulk(body.names || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('job-types/:id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() body: { name: string }, @Req() req) {
    return this.service.update(id, body.name, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('job-types/bulk')
  @UseGuards(JwtAuthGuard)
  async updateBulk(@Body() body: { items: { id: string; name: string }[] }, @Req() req) {
    return this.service.updateBulk(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('job-types/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('job-types/bulk')
  @UseGuards(JwtAuthGuard)
  async removeBulk(@Body() body: { ids: string[] }, @Req() req) {
    return this.service.removeBulk(body.ids || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
}
