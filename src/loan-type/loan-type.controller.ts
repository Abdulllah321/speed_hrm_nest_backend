import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { LoanTypeService } from './loan-type.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'

@Controller('api')
export class LoanTypeController {
  constructor(private service: LoanTypeService) {}

  @Get('loan-types')
  @UseGuards(JwtAuthGuard)
  async list() {
    return this.service.list()
  }

  @Get('loan-types/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('loan-types')
  @UseGuards(JwtAuthGuard)
  async create(@Body() body: { name: string; status?: string }, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('loan-types/:id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() body: { name: string; status?: string }, @Req() req) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('loan-types/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Post('loan-types/bulk')
  @UseGuards(JwtAuthGuard)
  async createBulk(@Body() body: { items: { name: string; status?: string }[] }, @Req() req) {
    return this.service.createBulk(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('loan-types/bulk')
  @UseGuards(JwtAuthGuard)
  async updateBulk(@Body() body: { items: { id: string; name: string; status?: string }[] }, @Req() req) {
    return this.service.updateBulk(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('loan-types/bulk')
  @UseGuards(JwtAuthGuard)
  async removeBulk(@Body() body: { ids: string[] }, @Req() req) {
    return this.service.removeBulk(body.ids || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
}
