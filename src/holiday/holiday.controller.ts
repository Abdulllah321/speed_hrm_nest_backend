import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { HolidayService } from './holiday.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger'
import { CreateHolidayDto, UpdateHolidayDto } from './dto/holiday.dto'

@ApiTags('Holiday')
@Controller('api')
export class HolidayController {
  constructor(private service: HolidayService) {}

  @Get('holidays')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all holidays' })
  async list() {
    return this.service.list()
  }

  @Get('holidays/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get holiday by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('holidays')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create holiday' })
  async create(
    @Body() body: CreateHolidayDto,
    @Req() req: any
  ) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('holidays/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update holiday' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateHolidayDto,
    @Req() req: any
  ) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('holidays/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete holiday' })
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Post('holidays/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create holidays in bulk' })
  @ApiBody({ type: CreateHolidayDto, isArray: true })
  async createBulk(
    @Body() body: { items: CreateHolidayDto[] },
    @Req() req: any
  ) {
    return this.service.createBulk(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('holidays/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update holidays in bulk' })
  @ApiBody({ type: UpdateHolidayDto, isArray: true })
  async updateBulk(
    @Body() body: { items: UpdateHolidayDto[] },
    @Req() req: any
  ) {
    return this.service.updateBulk((body.items as any) || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('holidays/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete holidays in bulk' })
  @ApiBody({ schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, example: ['uuid1', 'uuid2'] } } } })
  async removeBulk(@Body() body: { ids: string[] }, @Req() req: any) {
    return this.service.removeBulk(body.ids || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
}
