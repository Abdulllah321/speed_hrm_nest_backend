import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityLogsService } from '../activity-logs/activity-logs.service'
import { CreateSubDepartmentDto, UpdateDepartmentDto, UpdateSubDepartmentDto } from './dto/department-dto'

@Injectable()
export class DepartmentService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async getAllDepartments() {
    const departments = await this.prisma.department.findMany({
      include: { subDepartments: true, createdBy: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    })
    const data = departments.map(dept => ({
      ...dept,
      createdBy: dept.createdBy ? `${dept.createdBy.firstName} ${(dept.createdBy.lastName || '')}`.trim() : null,
    }))
    return { status: true, data }
  }

  async getDepartmentById(id: string) {
    const department = await this.prisma.department.findUnique({
      where: { id },
      include: { subDepartments: true, createdBy: { select: { firstName: true, lastName: true } } },
    })
    if (!department) return { status: false, message: 'Department not found' }
    const data = {
      ...department,
      createdBy: department.createdBy ? `${department.createdBy.firstName} ${(department.createdBy.lastName || '')}`.trim() : null,
    }
    return { status: true, data }
  }

  async createDepartments(names: string[], createdById: string) {
    try {
      const departments = await this.prisma.department.createMany({
        data: names.map(name => ({ name, createdById })),
        skipDuplicates: true,
      })
      await this.activityLogs.log({
          userId: createdById,
          action: 'create',
          module: 'departments',
          entity: 'Department',
          description: `Created departments (${departments.count})`,
          newValues: JSON.stringify(names),
          status: 'success',
      })
      return { status: true, data: departments }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: createdById,
          action: 'create',
          module: 'departments',
          entity: 'Department',
          description: 'Failed to create departments',
          errorMessage: error?.message,
          newValues: JSON.stringify(names),
          status: 'failure',
      })
      return { status: false, message: 'Failed to create departments' }
    }
  }

  async updateDepartment(id: string, updateDepartmentDto: UpdateDepartmentDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.department.findUnique({ where: { id } })
      const department = await this.prisma.department.update({
        where: { id },
        data: { name: updateDepartmentDto.name },
      })
      await this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'departments',
          entity: 'Department',
          entityId: id,
          description: `Updated department ${department.name}`,
          oldValues: JSON.stringify(existing),
          newValues: JSON.stringify(updateDepartmentDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
      })
      return { status: true, data: department }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'departments',
          entity: 'Department',
          entityId: id,
          description: 'Failed to update department',
          errorMessage: error?.message,
          newValues: JSON.stringify(updateDepartmentDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to update department' }
    }
  }

  async updateDepartments(updateDepartmentDto: UpdateDepartmentDto[], ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const updatedDepartments: any[] = []
      for (const dto of updateDepartmentDto) {
        const department = await this.prisma.department.update({ where: { id: dto.id }, data: { name: dto.name } })
        updatedDepartments.push(department)
      }
      await this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'departments',
          entity: 'Department',
          description: `Bulk updated departments (${updatedDepartments.length})`,
          newValues: JSON.stringify(updateDepartmentDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
      })
      return { status: true, data: updatedDepartments }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'departments',
          entity: 'Department',
          description: 'Failed bulk update departments',
          errorMessage: error?.message,
          newValues: JSON.stringify(updateDepartmentDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to update departments' }
    }
  }

  async deleteDepartments(departmentIds: string[], ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const departments = await this.prisma.department.deleteMany({ where: { id: { in: departmentIds } } })
      await this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'departments',
          entity: 'Department',
          description: `Bulk deleted departments (${departments.count})`,
          oldValues: JSON.stringify(departmentIds),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
      })
      return { status: true, data: departments }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'departments',
          entity: 'Department',
          description: 'Failed bulk delete departments',
          errorMessage: error?.message,
          oldValues: JSON.stringify(departmentIds),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to delete departments' }
    }
  }

  async deleteDepartment(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.department.findUnique({ where: { id } })
      const department = await this.prisma.department.delete({ where: { id } })
      await this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'departments',
          entity: 'Department',
          entityId: id,
          description: `Deleted department ${existing?.name}`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
      })
      return { status: true, data: department }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'departments',
          entity: 'Department',
          entityId: id,
          description: 'Failed to delete department',
          errorMessage: error?.message,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to delete department' }
    }
  }

  async getAllSubDepartments() {
    const subDepartments = await this.prisma.subDepartment.findMany({
      include: { department: true, createdBy: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    })
    const data = subDepartments.map(sd => ({
      ...sd,
      departmentName: sd.department.name,
      createdBy: sd.createdBy ? `${sd.createdBy.firstName} ${(sd.createdBy.lastName || '')}`.trim() : null,
    }))
    return { status: true, data }
  }

  async getSubDepartmentsByDepartment(departmentId: string) {
    const subDepartments = await this.prisma.subDepartment.findMany({
      where: { departmentId },
      include: { department: true, createdBy: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    })
    const data = subDepartments.map(sd => ({
      ...sd,
      departmentName: sd.department.name,
      createdBy: sd.createdBy ? `${sd.createdBy.firstName} ${(sd.createdBy.lastName || '')}`.trim() : null,
    }))
    return { status: true, data }
  }

  async createSubDepartments(createSubDepartmentDto: CreateSubDepartmentDto[], ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const subDepartments = await this.prisma.subDepartment.createMany({
        data: createSubDepartmentDto.map(dto => ({ name: dto.name, departmentId: dto.departmentId, createdById: dto.createdById })),
        skipDuplicates: true,
      })
      await this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'sub-departments',
          entity: 'SubDepartment',
          description: `Created sub-departments (${subDepartments.count})`,
          newValues: JSON.stringify(createSubDepartmentDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
      })
      return { status: true, data: subDepartments }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'sub-departments',
          entity: 'SubDepartment',
          description: 'Failed to create sub-departments',
          errorMessage: error?.message,
          newValues: JSON.stringify(createSubDepartmentDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to create sub-departments' }
    }
  }

  async updateSubDepartments(updateSubDepartmentDto: UpdateSubDepartmentDto[], ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const subDepartments = await this.prisma.subDepartment.updateMany({
        where: { id: { in: updateSubDepartmentDto.map(dto => dto.id) } },
        data: updateSubDepartmentDto.map(dto => ({ name: dto.name })),
      })
      await this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sub-departments',
          entity: 'SubDepartment',
          description: `Bulk updated sub-departments (${subDepartments.count})`,
          newValues: JSON.stringify(updateSubDepartmentDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
      })
      return { status: true, data: subDepartments }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sub-departments',
          entity: 'SubDepartment',
          description: 'Failed bulk update sub-departments',
          errorMessage: error?.message,
          newValues: JSON.stringify(updateSubDepartmentDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to update sub-departments' }
    }
  }

  async updateSubDepartment(id: string, updateSubDepartmentDto: UpdateSubDepartmentDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.subDepartment.findUnique({ where: { id } })
      const subDepartment = await this.prisma.subDepartment.update({ where: { id }, data: { name: updateSubDepartmentDto.name } })
      await this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sub-departments',
          entity: 'SubDepartment',
          entityId: id,
          description: `Updated sub-department ${subDepartment.name}`,
          oldValues: JSON.stringify(existing),
          newValues: JSON.stringify(updateSubDepartmentDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
      })
      return { status: true, data: subDepartment }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sub-departments',
          entity: 'SubDepartment',
          entityId: id,
          description: 'Failed to update sub-department',
          errorMessage: error?.message,
          newValues: JSON.stringify(updateSubDepartmentDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to update sub-department' }
    }
  }

  async deleteSubDepartments(subDepartmentIds: string[], ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const subDepartments = await this.prisma.subDepartment.deleteMany({ where: { id: { in: subDepartmentIds } } })
      await this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'sub-departments',
          entity: 'SubDepartment',
          description: `Bulk deleted sub-departments (${subDepartments.count})`,
          oldValues: JSON.stringify(subDepartmentIds),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
      })
      return { status: true, data: subDepartments }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'sub-departments',
          entity: 'SubDepartment',
          description: 'Failed bulk delete sub-departments',
          errorMessage: error?.message,
          oldValues: JSON.stringify(subDepartmentIds),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to delete sub-departments' }
    }
  }

  async deleteSubDepartment(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.subDepartment.findUnique({ where: { id } })
      const subDepartment = await this.prisma.subDepartment.delete({ where: { id } })
      await this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'sub-departments',
          entity: 'SubDepartment',
          entityId: id,
          description: `Deleted sub-department ${existing?.name}`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
      })
      return { status: true, data: subDepartment }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'sub-departments',
          entity: 'SubDepartment',
          entityId: id,
          description: 'Failed to delete sub-department',
          errorMessage: error?.message,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to delete sub-department' }
    }
  }
}