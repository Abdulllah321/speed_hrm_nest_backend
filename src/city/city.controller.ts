import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { CityService } from './city.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'

@Controller('api')
export class CityController {
  constructor(private service: CityService) {}

  @Get('countries')
  async countries() {
    return this.service.getAllCountries()
  }

  @Get('states')
  async states() {
    return this.service.getStates()
  }

  @Get('states/country/:countryId')
  async statesByCountry(@Param('countryId') countryId: string) {
    return this.service.getStatesByCountry(countryId)
  }

  @Get('cities/state/:stateId')
  async citiesByState(@Param('stateId') stateId: string) {
    return this.service.getCitiesByState(stateId)
  }

  @Get('cities')
  async cities() {
    return this.service.getCities()
  }

  @Post('cities/bulk')
  @UseGuards(JwtAuthGuard)
  async createCitiesBulk(@Body() body: { items: { name: string; countryId: string; stateId: string; status?: string }[] }, @Req() req) {
    return this.service.createCitiesBulk(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
}
