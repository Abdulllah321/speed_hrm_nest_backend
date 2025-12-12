import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { ExitClearanceService } from './exit-clearance.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'

@Controller('api')
export class ExitClearanceController {
  constructor(private service: ExitClearanceService) {}

  @Get('exit-clearances')
  @UseGuards(JwtAuthGuard)
  async list() {
    return this.service.list()
  }

  @Get('exit-clearances/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('exit-clearances')
  @UseGuards(JwtAuthGuard)
  async create(@Body() body: any, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('exit-clearances/:id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() body: any, @Req() req) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('exit-clearances/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
}

