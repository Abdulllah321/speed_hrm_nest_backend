import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { TaxSlabService } from './tax-slab.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger'
import { CreateTaxSlabDto, UpdateTaxSlabDto } from './dto/tax-slab.dto'

@ApiTags('Tax Slab')
@Controller('api')
export class TaxSlabController {
  constructor(private service: TaxSlabService) {}

  @Get('tax-slabs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all tax slabs' })
  async list() {
    return this.service.list()
  }

  @Get('tax-slabs/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get tax slab by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('tax-slabs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create tax slab' })
  async create(
    @Body() body: CreateTaxSlabDto,
    @Req() req: any,
  ) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Post('tax-slabs/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create tax slabs in bulk' })
  @ApiBody({ type: CreateTaxSlabDto, isArray: true })
  async createBulk(
    @Body() body: { items: CreateTaxSlabDto[] },
    @Req() req: any,
  ) {
    return this.service.createBulk(body.items ?? [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('tax-slabs/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update tax slab' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateTaxSlabDto,
    @Req() req: any,
  ) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('tax-slabs/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete tax slab' })
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('tax-slabs/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update tax slabs in bulk' })
  @ApiBody({ type: UpdateTaxSlabDto, isArray: true })
  async updateBulk(
    @Body() body: { items: UpdateTaxSlabDto[] },
    @Req() req: any,
  ) {
    return this.service.updateBulk((body.items as any) ?? [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('tax-slabs/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete tax slabs in bulk' })
  @ApiBody({ schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, example: ['uuid1', 'uuid2'] } } } })
  async removeBulk(@Body() body: { ids: string[] }, @Req() req: any) {
    return this.service.removeBulk(body.ids ?? [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
}
