import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { SalaryBreakupService } from './salary-breakup.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { CreateSalaryBreakupDto } from './dto/salary-breakup.dto'

@ApiTags('Salary Breakup')
@Controller('api')
export class SalaryBreakupController {
  constructor(private service: SalaryBreakupService) {}

  @Get('salary-breakups')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all salary breakups' })
  async list() {
    return this.service.list()
  }

  @Get('salary-breakups/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get salary breakup by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('salary-breakups')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create salary breakup' })
  async create(
    @Body() body: CreateSalaryBreakupDto,
    @Req() req: any
  ) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
}
