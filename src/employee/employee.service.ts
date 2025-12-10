import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityLogsService } from '../activity-logs/activity-logs.service'

@Injectable()
export class EmployeeService {
  constructor(private prisma: PrismaService, private activityLogs: ActivityLogsService) {}

  async list() {
    const employees = await this.prisma.employee.findMany({ orderBy: { createdAt: 'desc' } })
    return { status: true, data: employees }
  }

  async get(id: string) {
    const employee = await this.prisma.employee.findUnique({ where: { id } })
    if (!employee) return { status: false, message: 'Employee not found' }
    return { status: true, data: employee }
  }

  async create(body: any, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const created = await this.prisma.employee.create({
        data: {
          employeeId: body.employeeId,
          employeeName: body.employeeName,
          fatherHusbandName: body.fatherHusbandName,
          department: body.department,
          subDepartment: body.subDepartment ?? null,
          employeeGrade: body.employeeGrade,
          attendanceId: body.attendanceId,
          designation: body.designation,
          maritalStatus: body.maritalStatus,
          employmentStatus: body.employmentStatus,
          probationExpiryDate: body.probationExpiryDate ? new Date(body.probationExpiryDate) : null,
          cnicNumber: body.cnicNumber,
          cnicExpiryDate: body.cnicExpiryDate ? new Date(body.cnicExpiryDate) : null,
          lifetimeCnic: !!body.lifetimeCnic,
          joiningDate: new Date(body.joiningDate),
          dateOfBirth: new Date(body.dateOfBirth),
          nationality: body.nationality,
          gender: body.gender,
          contactNumber: body.contactNumber,
          emergencyContactNumber: body.emergencyContactNumber ?? null,
          emergencyContactPerson: body.emergencyContactPersonName ?? null,
          personalEmail: body.personalEmail ?? null,
          officialEmail: body.officialEmail,
          country: body.country,
          province: body.state,
          city: body.city,
          area: body.area ?? null,
          employeeSalary: body.employeeSalary as any,
          eobi: !!body.eobi,
          eobiNumber: body.eobiNumber ?? null,
          providentFund: !!body.providentFund,
          overtimeApplicable: !!body.overtimeApplicable,
          daysOff: body.daysOff ?? null,
          reportingManager: body.reportingManager,
          workingHoursPolicy: body.workingHoursPolicy,
          branch: body.branch,
          leavesPolicy: body.leavesPolicy,
          allowRemoteAttendance: !!body.allowRemoteAttendance,
          currentAddress: body.currentAddress ?? null,
          permanentAddress: body.permanentAddress ?? null,
          bankName: body.bankName,
          accountNumber: body.accountNumber,
          accountTitle: body.accountTitle,
          accountType: body.accountType ?? null,
          password: body.password ?? null,
          roles: body.roles ?? null,
          laptop: !!body.selectedEquipments?.includes('laptop'),
          card: !!body.selectedEquipments?.includes('card'),
          mobileSim: !!body.selectedEquipments?.includes('mobileSim'),
          key: !!body.selectedEquipments?.includes('key'),
          tools: !!body.selectedEquipments?.includes('tools'),
          status: 'active',
        },
      })

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'employees',
        entity: 'Employee',
        entityId: created.id,
        description: `Created employee ${created.employeeName}`,
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
        module: 'employees',
        entity: 'Employee',
        description: 'Failed to create employee',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to create employee' }
    }
  }

  async update(id: string, body: any, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.employee.findUnique({ where: { id } })
      const updated = await this.prisma.employee.update({
        where: { id },
        data: {
          employeeName: body.employeeName ?? existing?.employeeName,
          fatherHusbandName: body.fatherHusbandName ?? existing?.fatherHusbandName,
          department: body.department ?? existing?.department,
          subDepartment: body.subDepartment ?? existing?.subDepartment,
          employeeGrade: body.employeeGrade ?? existing?.employeeGrade,
          attendanceId: body.attendanceId ?? existing?.attendanceId,
          designation: body.designation ?? existing?.designation,
          maritalStatus: body.maritalStatus ?? existing?.maritalStatus,
          employmentStatus: body.employmentStatus ?? existing?.employmentStatus,
          probationExpiryDate: body.probationExpiryDate ? new Date(body.probationExpiryDate) : existing?.probationExpiryDate ?? null,
          cnicNumber: body.cnicNumber ?? existing?.cnicNumber,
          cnicExpiryDate: body.cnicExpiryDate ? new Date(body.cnicExpiryDate) : existing?.cnicExpiryDate ?? null,
          lifetimeCnic: body.lifetimeCnic ?? existing?.lifetimeCnic,
          joiningDate: body.joiningDate ? new Date(body.joiningDate) : existing?.joiningDate,
          dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : existing?.dateOfBirth,
          nationality: body.nationality ?? existing?.nationality,
          gender: body.gender ?? existing?.gender,
          contactNumber: body.contactNumber ?? existing?.contactNumber,
          emergencyContactNumber: body.emergencyContactNumber ?? existing?.emergencyContactNumber,
          emergencyContactPerson: body.emergencyContactPersonName ?? existing?.emergencyContactPerson,
          personalEmail: body.personalEmail ?? existing?.personalEmail,
          officialEmail: body.officialEmail ?? existing?.officialEmail,
          country: body.country ?? existing?.country,
          province: body.state ?? existing?.province,
          city: body.city ?? existing?.city,
          area: body.area ?? existing?.area,
          employeeSalary: body.employeeSalary !== undefined ? (body.employeeSalary as any) : existing?.employeeSalary,
          eobi: body.eobi ?? existing?.eobi,
          eobiNumber: body.eobiNumber ?? existing?.eobiNumber,
          providentFund: body.providentFund ?? existing?.providentFund,
          overtimeApplicable: body.overtimeApplicable ?? existing?.overtimeApplicable,
          daysOff: body.daysOff ?? existing?.daysOff,
          reportingManager: body.reportingManager ?? existing?.reportingManager,
          workingHoursPolicy: body.workingHoursPolicy ?? existing?.workingHoursPolicy,
          branch: body.branch ?? existing?.branch,
          leavesPolicy: body.leavesPolicy ?? existing?.leavesPolicy,
          allowRemoteAttendance: body.allowRemoteAttendance ?? existing?.allowRemoteAttendance,
          currentAddress: body.currentAddress ?? existing?.currentAddress,
          permanentAddress: body.permanentAddress ?? existing?.permanentAddress,
          bankName: body.bankName ?? existing?.bankName,
          accountNumber: body.accountNumber ?? existing?.accountNumber,
          accountTitle: body.accountTitle ?? existing?.accountTitle,
          accountType: body.accountType ?? existing?.accountType,
          password: body.password ?? existing?.password,
          roles: body.roles ?? existing?.roles,
          laptop: body.selectedEquipments ? !!body.selectedEquipments?.includes('laptop') : existing?.laptop,
          card: body.selectedEquipments ? !!body.selectedEquipments?.includes('card') : existing?.card,
          mobileSim: body.selectedEquipments ? !!body.selectedEquipments?.includes('mobileSim') : existing?.mobileSim,
          key: body.selectedEquipments ? !!body.selectedEquipments?.includes('key') : existing?.key,
          tools: body.selectedEquipments ? !!body.selectedEquipments?.includes('tools') : existing?.tools,
          status: body.status ?? existing?.status,
        },
      })

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'employees',
        entity: 'Employee',
        entityId: id,
        description: `Updated employee ${updated.employeeName}`,
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
        module: 'employees',
        entity: 'Employee',
        entityId: id,
        description: 'Failed to update employee',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to update employee' }
    }
  }

  async remove(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.employee.findUnique({ where: { id } })
      const removed = await this.prisma.employee.delete({ where: { id } })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'employees',
        entity: 'Employee',
        entityId: id,
        description: `Deleted employee ${existing?.employeeName}`,
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
        module: 'employees',
        entity: 'Employee',
        entityId: id,
        description: 'Failed to delete employee',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to delete employee' }
    }
  }
}
