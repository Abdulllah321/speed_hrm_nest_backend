import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { ProvidentFundService } from './provident-fund.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'

@Controller('api')
export class ProvidentFundController {
  constructor(private service: ProvidentFundService) {}

  @Get('provident-funds')
  @UseGuards(JwtAuthGuard)
  async list() {
    return this.service.list()
  }

  @Get('provident-funds/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('provident-funds')
  @UseGuards(JwtAuthGuard)
  async create(
    @Body() body: { name: string; percentage: number; status?: string },
    @Req() req: any,
  ) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Post('provident-funds/bulk')
  @UseGuards(JwtAuthGuard)
  async createBulk(
    @Body() body: { items: { name: string; percentage: number; status?: string }[] },
    @Req() req: any,
  ) {
    return this.service.createBulk(body.items ?? [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('provident-funds/:id')
  @UseGuards(JwtAuthGuard)
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; percentage?: number; status?: string },
    @Req() req: any,
  ) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('provident-funds/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
}
