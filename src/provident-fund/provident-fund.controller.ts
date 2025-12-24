import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { ProvidentFundService } from './provident-fund.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger'
import { CreateProvidentFundDto, UpdateProvidentFundDto } from './dto/provident-fund.dto'

@ApiTags('Provident Fund')
@Controller('api')
export class ProvidentFundController {
  constructor(private service: ProvidentFundService) {}

  @Get('provident-funds')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all provident funds' })
  async list() {
    return this.service.list()
  }

  @Get('provident-funds/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get provident fund by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('provident-funds')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create provident fund' })
  async create(
    @Body() body: CreateProvidentFundDto,
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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create provident funds in bulk' })
  @ApiBody({ type: CreateProvidentFundDto, isArray: true })
  async createBulk(
    @Body() body: { items: CreateProvidentFundDto[] },
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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update provident fund' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateProvidentFundDto,
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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete provident fund' })
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
}
