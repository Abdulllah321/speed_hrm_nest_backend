import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { SalaryBreakupService } from './salary-breakup.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'

@Controller('api')
export class SalaryBreakupController {
  constructor(private service: SalaryBreakupService) {}

  @Get('salary-breakups')
  @UseGuards(JwtAuthGuard)
  async list() {
    return this.service.list()
  }

  @Get('salary-breakups/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('salary-breakups')
  @UseGuards(JwtAuthGuard)
  async create(
    @Body() body: { name: string; details?: any; status?: string },
    @Req() req: any
  ) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
}
