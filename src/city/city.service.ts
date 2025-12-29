import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityLogsService } from '../activity-logs/activity-logs.service'

@Injectable()
export class CityService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) { }

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
    const cities = await this.prisma.city.findMany({
      include: { country: true, state: true },
      orderBy: { name: 'asc' },
    })
    return { status: true, data: cities }
  }

  async create(body: { name: string; countryId: string; stateId: string; status?: string }, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const created = await this.prisma.city.create({
        data: {
          name: body.name,
          countryId: body.countryId,
          stateId: body.stateId,
          status: body.status ?? 'active',
          createdById: ctx.userId,
        },
      })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'cities',
        entity: 'City',
        entityId: created.id,
        description: `Created city ${created.name}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })
      return { status: true, data: created }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'cities',
        entity: 'City',
        description: 'Failed to create city',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })

      if (error?.code === 'P2002') {
        return { status: false, message: 'A city with this name already exists in this state' }
      }

      return { status: false, message: 'Failed to create city' }
    }
  }

  async update(id: string, body: { name?: string; countryId?: string; stateId?: string; status?: string }, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.city.findUnique({ where: { id } })
      if (!existing) {
        return { status: false, message: 'City not found' }
      }

      const updated = await this.prisma.city.update({
        where: { id },
        data: {
          name: body.name ?? existing.name,
          countryId: body.countryId ?? existing.countryId,
          stateId: body.stateId ?? existing.stateId,
          status: body.status ?? existing.status,
        },
      })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'cities',
        entity: 'City',
        entityId: id,
        description: `Updated city ${updated.name}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })
      return { status: true, data: updated }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'cities',
        entity: 'City',
        entityId: id,
        description: 'Failed to update city',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })

      if (error?.code === 'P2002') {
        return { status: false, message: 'A city with this name already exists in this state' }
      }

      return { status: false, message: 'Failed to update city' }
    }
  }

  async remove(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.city.findUnique({ where: { id } })
      if (!existing) {
        return { status: false, message: 'City not found' }
      }

      const removed = await this.prisma.city.delete({ where: { id } })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'cities',
        entity: 'City',
        entityId: id,
        description: `Deleted city ${existing.name}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })
      return { status: true, data: removed }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'cities',
        entity: 'City',
        entityId: id,
        description: 'Failed to delete city',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to delete city' }
    }
  }

  async removeBulk(ids: string[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!ids?.length) return { status: false, message: 'No cities to delete' }
    try {
      const existing = await this.prisma.city.findMany({ where: { id: { in: ids } } })
      const result = await this.prisma.city.deleteMany({ where: { id: { in: ids } } })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'cities',
        entity: 'City',
        description: `Bulk deleted cities (${result.count})`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })
      return { status: true, message: 'Cities deleted', data: result }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'cities',
        entity: 'City',
        description: 'Failed to bulk delete cities',
        errorMessage: error?.message,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to delete cities' }
    }
  }

  async createCitiesBulk(items: { name: string; countryId: string; stateId: string; status?: string }[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!items?.length) return { status: false, message: 'No items to create' }
    try {
      const result = await this.prisma.city.createMany({
        data: items.map(i => ({ name: i.name, countryId: i.countryId, stateId: i.stateId, status: i.status ?? 'active', createdById: ctx.userId })),
        skipDuplicates: true,
      })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'cities',
        entity: 'City',
        description: `Bulk created cities (${result.count})`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })
      return { status: true, message: 'Cities created', data: result }
    } catch (error: any) {
      await this.activityLogs.log({
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
      })
      return { status: false, message: 'Failed to create cities' }
    }
  }
}
