import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { EobiService } from './eobi.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'

@Controller('api')
export class EobiController {
  constructor(private service: EobiService) {}

  @Get('eobis')
  @UseGuards(JwtAuthGuard)
  async list() {
    return this.service.list()
  }

  @Get('eobis/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('eobis')
  @UseGuards(JwtAuthGuard)
  async create(
    @Body() body: { name: string; amount: number; yearMonth: string; status?: string },
    @Req() req: any,
  ) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Post('eobis/bulk')
  @UseGuards(JwtAuthGuard)
  async createBulk(
    @Body() body: { items: { name: string; amount: number; yearMonth: string; status?: string }[] },
    @Req() req: any,
  ) {
    return this.service.createBulk(body.items ?? [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('eobis/:id')
  @UseGuards(JwtAuthGuard)
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; amount?: number; yearMonth?: string; status?: string },
    @Req() req: any,
  ) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('eobis/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('eobis/bulk')
  @UseGuards(JwtAuthGuard)
  async updateBulk(
    @Body() body: { items: { id: string; name: string; amount: number; yearMonth: string; status?: string }[] },
    @Req() req: any,
  ) {
    return this.service.updateBulk(body.items ?? [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('eobis/bulk')
  @UseGuards(JwtAuthGuard)
  async removeBulk(@Body() body: { ids: string[] }, @Req() req: any) {
    return this.service.removeBulk(body.ids ?? [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
}
