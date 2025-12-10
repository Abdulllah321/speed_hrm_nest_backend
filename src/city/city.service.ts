import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class CityService {
  constructor(private prisma: PrismaService) {}

  async getAllCountries() {
    const countries = await this.prisma.country.findMany({ include: { cities: true }, orderBy: { name: 'asc' } })
    return { status: true, data: countries }
  }

  async getStates() {
    const states = await this.prisma.state.findMany({ orderBy: { name: 'asc' } })
    return { status: true, data: states }
  }

  async getStatesByCountry(countryId: string) {
    const states = await this.prisma.state.findMany({ where: { countryId }, orderBy: { name: 'asc' } })
    return { status: true, data: states }
  }

  async getCitiesByState(stateId: string) {
    const cities = await this.prisma.city.findMany({ where: { stateId }, orderBy: { name: 'asc' } })
    return { status: true, data: cities }
  }

  async getCities() {
    const cities = await this.prisma.city.findMany({ orderBy: { name: 'asc' } })
    return { status: true, data: cities }
  }

  async createCitiesBulk(items: { name: string; countryId: string; stateId: string; status?: string }[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!items?.length) return { status: false, message: 'No items to create' }
    try {
      const result = await this.prisma.city.createMany({
        data: items.map(i => ({ name: i.name, countryId: i.countryId, stateId: i.stateId, status: i.status ?? 'active', createdById: ctx.userId })),
        skipDuplicates: true,
      })
      await this.prisma.activityLog.create({
        data: {
          userId: ctx.userId,
          action: 'create',
          module: 'cities',
          entity: 'City',
          description: `Bulk created cities (${result.count})`,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        },
      })
      return { status: true, message: 'Cities created', data: result }
    } catch (error: any) {
      await this.prisma.activityLog.create({
        data: {
          userId: ctx.userId,
          action: 'create',
          module: 'cities',
          entity: 'City',
          description: 'Failed bulk create cities',
          errorMessage: error?.message,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        },
      })
      return { status: false, message: 'Failed to create cities' }
    }
  }
}
