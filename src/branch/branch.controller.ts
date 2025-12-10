import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { BranchService } from './branch.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'

@Controller('api')
export class BranchController {
  constructor(private service: BranchService) {}

  @Get('branches')
  @UseGuards(JwtAuthGuard)
  async list() {
    return this.service.list()
  }

  @Get('branches/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('branches')
  @UseGuards(JwtAuthGuard)
  async create(@Body() body: { name: string; address?: string; cityId?: string; status?: string }, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('branches/:id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() body: { name: string; address?: string; cityId?: string; status?: string }, @Req() req) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('branches/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Post('branches/bulk')
  @UseGuards(JwtAuthGuard)
  async createBulk(
    @Body()
    body: { items: { name: string; address?: string; cityId?: string; status?: string }[] },
    @Req() req,
  ) {
    return this.service.createBulk(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('branches/bulk')
  @UseGuards(JwtAuthGuard)
  async updateBulk(
    @Body()
    body: { items: { id: string; name: string; address?: string; cityId?: string; status?: string }[] },
    @Req() req,
  ) {
    return this.service.updateBulk(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('branches/bulk')
  @UseGuards(JwtAuthGuard)
  async removeBulk(@Body() body: { ids: string[] }, @Req() req) {
    return this.service.removeBulk(body.ids || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
}
