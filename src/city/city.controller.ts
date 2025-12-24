import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { CityService } from './city.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger'
import { CreateCityDto } from './dto/city.dto'

@ApiTags('City')
@Controller('api')
export class CityController {
  constructor(private service: CityService) {}

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
}
