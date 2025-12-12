import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityLogsService } from '../activity-logs/activity-logs.service'

@Injectable()
export class ExitClearanceService {
  constructor(private prisma: PrismaService, private activityLogs: ActivityLogsService) {}

  async list() {
    const clearances = await this.prisma.exitClearance.findMany({ orderBy: { createdAt: 'desc' } })
    return { status: true, data: clearances }
  }

  async get(id: string) {
    const clearance = await this.prisma.exitClearance.findUnique({ where: { id } })
    if (!clearance) return { status: false, message: 'Exit clearance not found' }
    return { status: true, data: clearance }
  }

  async create(body: any, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const created = await this.prisma.exitClearance.create({
        data: {
          employeeName: body.employeeName,
          designation: body.designation ?? null,
          department: body.department ?? null,
          subDepartment: body.subDepartment ?? null,
          location: body.location ?? null,
          leavingReason: body.leavingReason ?? null,
          contractEnd: body.contractEnd ? new Date(body.contractEnd) : null,
          lastWorkingDate: new Date(body.lastWorkingDate),
          reportingManager: body.reportingManager ?? null,
          date: body.date ? new Date(body.date) : new Date(),
          // IT Department
          itAccessControl: !!body.itAccessControl,
          itPasswordInactivated: !!body.itPasswordInactivated,
          itLaptopReturned: !!body.itLaptopReturned,
          itEquipment: !!body.itEquipment,
          itWifiDevice: !!body.itWifiDevice,
          itMobileDevice: !!body.itMobileDevice,
          itSimCard: !!body.itSimCard,
          itBillsSettlement: !!body.itBillsSettlement,
          // Finance Department
          financeAdvance: !!body.financeAdvance,
          financeLoan: !!body.financeLoan,
          financeOtherLiabilities: !!body.financeOtherLiabilities,
          // Admin Department
          adminVehicle: !!body.adminVehicle,
          adminKeys: !!body.adminKeys,
          adminOfficeAccessories: !!body.adminOfficeAccessories,
          adminMobilePhone: !!body.adminMobilePhone,
          adminVisitingCards: !!body.adminVisitingCards,
          // HR Department
          hrEobi: !!body.hrEobi,
          hrProvidentFund: !!body.hrProvidentFund,
          hrIdCard: !!body.hrIdCard,
          hrMedical: !!body.hrMedical,
          hrThumbImpression: !!body.hrThumbImpression,
          hrLeavesRemaining: !!body.hrLeavesRemaining,
          hrOtherCompensation: !!body.hrOtherCompensation,
          note: body.note ?? null,
          approvalStatus: body.approvalStatus || 'pending',
        },
      })

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'exit-clearance',
        entity: 'ExitClearance',
        entityId: created.id,
        description: `Created exit clearance for ${created.employeeName}`,
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
        module: 'exit-clearance',
        entity: 'ExitClearance',
        description: 'Failed to create exit clearance',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })

      return { status: false, message: error?.message || 'Failed to create exit clearance' }
    }
  }

  async update(id: string, body: any, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.exitClearance.findUnique({ where: { id } })
      if (!existing) {
        return { status: false, message: 'Exit clearance not found' }
      }

      const updated = await this.prisma.exitClearance.update({
        where: { id },
        data: {
          employeeName: body.employeeName !== undefined ? body.employeeName : existing.employeeName,
          designation: body.designation !== undefined ? body.designation : existing.designation,
          department: body.department !== undefined ? body.department : existing.department,
          subDepartment: body.subDepartment !== undefined ? body.subDepartment : existing.subDepartment,
          location: body.location !== undefined ? body.location : existing.location,
          leavingReason: body.leavingReason !== undefined ? body.leavingReason : existing.leavingReason,
          contractEnd: body.contractEnd !== undefined ? (body.contractEnd ? new Date(body.contractEnd) : null) : existing.contractEnd,
          lastWorkingDate: body.lastWorkingDate !== undefined ? new Date(body.lastWorkingDate) : existing.lastWorkingDate,
          reportingManager: body.reportingManager !== undefined ? body.reportingManager : existing.reportingManager,
          date: body.date !== undefined ? (body.date ? new Date(body.date) : new Date()) : existing.date,
          // IT Department
          itAccessControl: body.itAccessControl !== undefined ? !!body.itAccessControl : existing.itAccessControl,
          itPasswordInactivated: body.itPasswordInactivated !== undefined ? !!body.itPasswordInactivated : existing.itPasswordInactivated,
          itLaptopReturned: body.itLaptopReturned !== undefined ? !!body.itLaptopReturned : existing.itLaptopReturned,
          itEquipment: body.itEquipment !== undefined ? !!body.itEquipment : existing.itEquipment,
          itWifiDevice: body.itWifiDevice !== undefined ? !!body.itWifiDevice : existing.itWifiDevice,
          itMobileDevice: body.itMobileDevice !== undefined ? !!body.itMobileDevice : existing.itMobileDevice,
          itSimCard: body.itSimCard !== undefined ? !!body.itSimCard : existing.itSimCard,
          itBillsSettlement: body.itBillsSettlement !== undefined ? !!body.itBillsSettlement : existing.itBillsSettlement,
          // Finance Department
          financeAdvance: body.financeAdvance !== undefined ? !!body.financeAdvance : existing.financeAdvance,
          financeLoan: body.financeLoan !== undefined ? !!body.financeLoan : existing.financeLoan,
          financeOtherLiabilities: body.financeOtherLiabilities !== undefined ? !!body.financeOtherLiabilities : existing.financeOtherLiabilities,
          // Admin Department
          adminVehicle: body.adminVehicle !== undefined ? !!body.adminVehicle : existing.adminVehicle,
          adminKeys: body.adminKeys !== undefined ? !!body.adminKeys : existing.adminKeys,
          adminOfficeAccessories: body.adminOfficeAccessories !== undefined ? !!body.adminOfficeAccessories : existing.adminOfficeAccessories,
          adminMobilePhone: body.adminMobilePhone !== undefined ? !!body.adminMobilePhone : existing.adminMobilePhone,
          adminVisitingCards: body.adminVisitingCards !== undefined ? !!body.adminVisitingCards : existing.adminVisitingCards,
          // HR Department
          hrEobi: body.hrEobi !== undefined ? !!body.hrEobi : existing.hrEobi,
          hrProvidentFund: body.hrProvidentFund !== undefined ? !!body.hrProvidentFund : existing.hrProvidentFund,
          hrIdCard: body.hrIdCard !== undefined ? !!body.hrIdCard : existing.hrIdCard,
          hrMedical: body.hrMedical !== undefined ? !!body.hrMedical : existing.hrMedical,
          hrThumbImpression: body.hrThumbImpression !== undefined ? !!body.hrThumbImpression : existing.hrThumbImpression,
          hrLeavesRemaining: body.hrLeavesRemaining !== undefined ? !!body.hrLeavesRemaining : existing.hrLeavesRemaining,
          hrOtherCompensation: body.hrOtherCompensation !== undefined ? !!body.hrOtherCompensation : existing.hrOtherCompensation,
          note: body.note !== undefined ? body.note : existing.note,
          approvalStatus: body.approvalStatus !== undefined ? body.approvalStatus : existing.approvalStatus,
        },
      })

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'exit-clearance',
        entity: 'ExitClearance',
        entityId: updated.id,
        description: `Updated exit clearance for ${updated.employeeName}`,
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
        module: 'exit-clearance',
        entity: 'ExitClearance',
        entityId: id,
        description: 'Failed to update exit clearance',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })

      return { status: false, message: error?.message || 'Failed to update exit clearance' }
    }
  }

  async remove(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.exitClearance.findUnique({ where: { id } })
      if (!existing) {
        return { status: false, message: 'Exit clearance not found' }
      }

      await this.prisma.exitClearance.delete({ where: { id } })

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'exit-clearance',
        entity: 'ExitClearance',
        entityId: id,
        description: `Deleted exit clearance for ${existing.employeeName}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })

      return { status: true, message: 'Exit clearance deleted successfully' }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'exit-clearance',
        entity: 'ExitClearance',
        entityId: id,
        description: 'Failed to delete exit clearance',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })

      return { status: false, message: error?.message || 'Failed to delete exit clearance' }
    }
  }
}

