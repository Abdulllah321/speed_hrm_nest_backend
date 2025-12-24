import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { DeductionHeadService } from './deduction-head.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger'
import { CreateDeductionHeadDto, UpdateDeductionHeadDto } from './dto/deduction-head.dto'

@ApiTags('Deduction Head')
@Controller('api')
export class DeductionHeadController {
  constructor(private service: DeductionHeadService) {}

  @Get('deduction-heads')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all deduction heads' })
  async list() {
    return this.service.list()
  }

  @Get('deduction-heads/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get deduction head by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('deduction-heads')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create deduction head' })
  async create(@Body() body: CreateDeductionHeadDto, @Req() req) {
    return this.service.create(body.name, body.status, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Post('deduction-heads/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create deduction heads in bulk' })
  @ApiBody({ type: CreateDeductionHeadDto, isArray: true })
  async createBulk(@Body() body: { items: CreateDeductionHeadDto[] }, @Req() req) {
    return this.service.createBulk(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('deduction-heads/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update deduction head' })
  async update(@Param('id') id: string, @Body() body: UpdateDeductionHeadDto, @Req() req) {
    return this.service.update(id, body.name, body.status, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('deduction-heads/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update deduction heads in bulk' })
  @ApiBody({ type: UpdateDeductionHeadDto, isArray: true })
  async updateBulk(@Body() body: { items: UpdateDeductionHeadDto[] }, @Req() req) {
    return this.service.updateBulk((body.items as any) || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('deduction-heads/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete deduction head' })
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('deduction-heads/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete deduction heads in bulk' })
  @ApiBody({ schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, example: ['uuid1', 'uuid2'] } } } })
  async removeBulk(@Body() body: { ids: string[] }, @Req() req) {
    return this.service.removeBulk(body.ids || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
}

