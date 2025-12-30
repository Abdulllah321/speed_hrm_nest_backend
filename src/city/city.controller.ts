import { Body, Controller, Get, Param, Post, Req, UseGuards, Put, Delete } from '@nestjs/common'
import { CityService } from './city.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger'
import { CreateCityDto } from './dto/city.dto'

@ApiTags('City')
@Controller('api')
export class CityController {
  constructor(private service: CityService) { }

  @Get('countries')
  @ApiOperation({ summary: 'List all countries' })
  async countries() {
    return this.service.getAllCountries()
  }

  @Get('states')
  @ApiOperation({ summary: 'List all states' })
  async states() {
    return this.service.getStates()
  }

  @Get('states/country/:countryId')
  @ApiOperation({ summary: 'List states by country' })
  async statesByCountry(@Param('countryId') countryId: string) {
    return this.service.getStatesByCountry(countryId)
  }

  @Get('cities/state/:stateId')
  @ApiOperation({ summary: 'List cities by state' })
  async citiesByState(@Param('stateId') stateId: string) {
    return this.service.getCitiesByState(stateId)
  }

  @Get('cities')
  @ApiOperation({ summary: 'List all cities' })
  async cities() {
    return this.service.getCities()
  }

  @Post('cities/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create cities in bulk' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              countryId: { type: 'string' },
              stateId: { type: 'string' },
              status: { type: 'string' },
            },
            required: ['name', 'countryId', 'stateId'],
          },
        },
      },
    },
  })
  async createCitiesBulk(@Body() body: { items: { name: string; countryId: string; stateId: string; status?: string }[] }, @Req() req) {
    return this.service.createCitiesBulk(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
  @Post('cities')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create city' })
  @ApiBody({ schema: { type: 'object', properties: { name: { type: 'string', example: 'Lahore' }, countryId: { type: 'string' }, stateId: { type: 'string' }, status: { type: 'string', example: 'active' } } } })
  async create(@Body() body: { name: string; countryId: string; stateId: string; status?: string }, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Put('cities/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update city' })
  @ApiBody({ schema: { type: 'object', properties: { name: { type: 'string', example: 'Lahore' }, countryId: { type: 'string' }, stateId: { type: 'string' }, status: { type: 'string', example: 'active' } } } })
  async update(@Param('id') id: string, @Body() body: { name?: string; countryId?: string; stateId?: string; status?: string }, @Req() req) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('cities/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete cities in bulk' })
  @ApiBody({ schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, example: ['uuid1', 'uuid2'] } } } })
  async removeBulk(@Body() body: { ids: string[] }, @Req() req) {
    return this.service.removeBulk(body.ids || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  @Delete('cities/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete city' })
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
}
