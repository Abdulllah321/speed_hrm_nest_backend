import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { QualificationService } from './qualification.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'

@Controller('api')
export class QualificationController {
  constructor(private service: QualificationService) {}

  @Get('qualifications')
  @UseGuards(JwtAuthGuard)
  async list() {
    return this.service.list()
  }

  @Get('qualifications/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('qualifications')
  @UseGuards(JwtAuthGuard)
  async create(@Body() body: { name: string; status?: string }, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Post('qualifications/bulk')
  @UseGuards(JwtAuthGuard)
  async createBulk(@Body() body: { items: { name: string; status?: string }[] }, @Req() req) {
    return this.service.createBulk(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('qualifications/:id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() body: { name?: string; status?: string }, @Req() req) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('qualifications/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('qualifications/bulk')
  @UseGuards(JwtAuthGuard)
  async removeBulk(@Body() body: { ids: string[] }, @Req() req) {
    return this.service.removeBulk(body.ids || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
}
