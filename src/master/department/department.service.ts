import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import {
  CreateSubDepartmentDto,
  UpdateDepartmentDto,
  UpdateSubDepartmentDto,
  BulkUpdateDepartmentItemDto,
} from './dto/department-dto';

@Injectable()
export class DepartmentService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async getAllDepartments() {
    const cacheKey = 'departments_all';
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      return { status: true, data: cachedData };
    }

    const departments = await this.prisma.department.findMany({
      include: {
        subDepartments: true,
        createdBy: { select: { firstName: true, lastName: true } },
        head: { select: { id: true, employeeId: true, employeeName: true } },
        allocation: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const data = departments.map((dept) => ({
      ...dept,
      createdBy: dept.createdBy
        ? `${dept.createdBy.firstName} ${dept.createdBy.lastName || ''}`.trim()
        : null,
      headName: dept.head
        ? `${dept.head.employeeName} (${dept.head.employeeId})`
        : null,
      allocationName: dept.allocation ? dept.allocation.name : null,
    }));

    await this.cacheManager.set(cacheKey, data, 3600000); // 1 hour TTL
    return { status: true, data };
  }

  async getDepartmentById(id: string) {
    const department = await this.prisma.department.findUnique({
      where: { id },
      include: {
        subDepartments: true,
        createdBy: { select: { firstName: true, lastName: true } },
        head: { select: { id: true, employeeId: true, employeeName: true } },
        allocation: { select: { id: true, name: true } },
      },
    });
    if (!department) return { status: false, message: 'Department not found' };
    const data = {
      ...department,
      createdBy: department.createdBy
        ? `${department.createdBy.firstName} ${department.createdBy.lastName || ''}`.trim()
        : null,
      headName: department.head
        ? `${department.head.employeeName} (${department.head.employeeId})`
        : null,
      allocationName: department.allocation ? department.allocation.name : null,
    };
    return { status: true, data };
  }

  async createDepartments(
    items: { name: string; allocationId?: string; headId?: string }[],
    createdById: string,
  ) {
    try {
      // We use a transaction or just loop since createMany doesn't support all relations/validations properly if we want to return full objects or potential errors per item easily
      // But for bulk insert efficiency createMany is better. However, createMany cannot set relations if they are not foreign keys directly.
      // Fortunately allocationId and headId are FKs on Department.

      const departments = await this.prisma.department.createMany({
        data: items.map((item) => ({
          name: item.name,
          allocationId: item.allocationId || null,
          headId: item.headId || null,
          createdById,
        })),
        skipDuplicates: true,
      });

      await this.activityLogs.log({
        userId: createdById,
        action: 'create',
        module: 'departments',
        entity: 'Department',
        description: `Created departments (${departments.count})`,
        newValues: JSON.stringify(items),
        status: 'success',
      });
      await this.cacheManager.del('departments_all');
      return {
        status: true,
        data: departments,
        message: 'Departments created successfully',
      };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: createdById,
        action: 'create',
        module: 'departments',
        entity: 'Department',
        description: 'Failed to create departments',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        status: 'failure',
      });
      return {
        status: false,
        message: 'Failed to create departments',
        data: null,
      };
    }
  }

  async updateDepartment(
    id: string,
    updateDepartmentDto: UpdateDepartmentDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.department.findUnique({
        where: { id },
      });
      const department = await this.prisma.department.update({
        where: { id },
        data: {
          name: updateDepartmentDto.name,
          headId: updateDepartmentDto.headId || null,
          allocationId: updateDepartmentDto.allocationId || null,
        },
      });
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
      });
      await this.cacheManager.del('departments_all');
      return {
        status: true,
        data: department,
        message: 'Department updated successfully',
      };
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
      });
      return {
        status: false,
        message: 'Failed to update department',
        data: null,
      };
    }
  }

  async updateDepartments(
    updateDepartmentDto: BulkUpdateDepartmentItemDto[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      // Filter out items with empty or invalid IDs (for bulk updates, id is required)
      const validDtos = (updateDepartmentDto || []).filter(
        (dto) => dto.id && dto.id.trim().length > 0,
      );
      if (validDtos.length === 0) {
        return { status: false, message: 'No valid department IDs provided' };
      }

      const updatedDepartments: any[] = [];
      for (const dto of validDtos) {
        if (!dto.id) {
          continue; // Skip items without ID (shouldn't happen due to filter, but defensive check)
        }
        const department = await this.prisma.department.update({
          where: { id: dto.id },
          data: {
            name: dto.name,
            headId: dto.headId || null,
            allocationId: dto.allocationId || null,
          },
        });
        updatedDepartments.push(department);
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
      });
      await this.cacheManager.del('departments_all');
      return {
        status: true,
        data: updatedDepartments,
        message: 'Departments updated successfully',
      };
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
      });
      return {
        status: false,
        message: 'Failed to update departments',
        data: null,
      };
    }
  }

  async deleteDepartments(
    departmentIds: string[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const departments = await this.prisma.department.deleteMany({
        where: { id: { in: departmentIds } },
      });
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
      });
      await this.cacheManager.del('departments_all');
      return {
        status: true,
        data: departments,
        message: 'Departments deleted successfully',
      };
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
      });
      return {
        status: false,
        message: 'Failed to delete departments',
        data: null,
      };
    }
  }

  async deleteDepartment(
    id: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.department.findUnique({
        where: { id },
      });
      const department = await this.prisma.department.delete({ where: { id } });
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
      });
      await this.cacheManager.del('departments_all');
      return {
        status: true,
        data: department,
        message: 'Department deleted successfully',
      };
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
      });
      return {
        status: false,
        message: 'Failed to delete department',
        data: null,
      };
    }
  }

  async getAllSubDepartments() {
    const cacheKey = 'subdepartments_all';
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      return {
        status: true,
        data: cachedData,
        message: 'Sub-departments fetched successfully',
      };
    }

    const subDepartments = await this.prisma.subDepartment.findMany({
      include: {
        department: true,
        createdBy: { select: { firstName: true, lastName: true } },
        head: { select: { id: true, employeeId: true, employeeName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const data = subDepartments.map((sd) => ({
      ...sd,
      departmentName: sd.department.name,
      createdBy: sd.createdBy
        ? `${sd.createdBy.firstName} ${sd.createdBy.lastName || ''}`.trim()
        : null,
      headName: sd.head
        ? `${sd.head.employeeName} (${sd.head.employeeId})`
        : null,
    }));

    await this.cacheManager.set(cacheKey, data, 3600000);
    return {
      status: true,
      data,
      message: 'Sub-departments fetched successfully',
    };
  }

  async getSubDepartmentsByDepartment(departmentId: string) {
    const subDepartments = await this.prisma.subDepartment.findMany({
      where: { departmentId },
      include: {
        department: true,
        createdBy: { select: { firstName: true, lastName: true } },
        head: { select: { id: true, employeeId: true, employeeName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const data = subDepartments.map((sd) => ({
      ...sd,
      departmentName: sd.department.name,
      createdBy: sd.createdBy
        ? `${sd.createdBy.firstName} ${sd.createdBy.lastName || ''}`.trim()
        : null,
      headName: sd.head
        ? `${sd.head.employeeName} (${sd.head.employeeId})`
        : null,
    }));
    return {
      status: true,
      data,
      message: 'Sub-departments fetched successfully',
    };
  }

  async createSubDepartments(
    createSubDepartmentDto: CreateSubDepartmentDto[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const subDepartments = await this.prisma.subDepartment.createMany({
        data: createSubDepartmentDto.map((dto) => ({
          name: dto.name,
          departmentId: dto.departmentId,
          createdById: dto.createdById,
          headId: (dto as any).headId || null,
        })),
        skipDuplicates: true,
      });
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
      });
      await this.cacheManager.del('subdepartments_all');
      // Also invalidate departments as they contain subDepartments relation
      await this.cacheManager.del('departments_all');
      return {
        status: true,
        data: subDepartments,
        message: 'Sub-departments created successfully',
      };
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
      });
      return {
        status: false,
        message: 'Failed to create sub-departments',
        data: null,
      };
    }
  }

  async updateSubDepartments(
    updateSubDepartmentDto: UpdateSubDepartmentDto[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      // Filter out items with empty or invalid IDs (for bulk updates, id is required)
      const validDtos = (updateSubDepartmentDto || []).filter(
        (dto) => dto.id && dto.id.trim().length > 0,
      );
      if (validDtos.length === 0) {
        return {
          status: false,
          message: 'No valid sub-department IDs provided',
        };
      }

      const updatedSubDepartments: any[] = [];
      for (const dto of validDtos) {
        if (!dto.id) {
          continue; // Skip items without ID (shouldn't happen due to filter, but defensive check)
        }
        const subDepartment = await this.prisma.subDepartment.update({
          where: { id: dto.id },
          data: {
            name: dto.name,
            headId: dto.headId || null,
          },
        });
        updatedSubDepartments.push(subDepartment);
      }
      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'sub-departments',
        entity: 'SubDepartment',
        description: `Bulk updated sub-departments (${updatedSubDepartments.length})`,
        newValues: JSON.stringify(updateSubDepartmentDto),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('subdepartments_all');
      await this.cacheManager.del('departments_all');
      return {
        status: true,
        data: updatedSubDepartments,
        message: 'Sub-departments updated successfully',
      };
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
      });
      return {
        status: false,
        message: 'Failed to update sub-departments',
        data: null,
      };
    }
  }

  async updateSubDepartment(
    id: string,
    updateSubDepartmentDto: UpdateSubDepartmentDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.subDepartment.findUnique({
        where: { id },
      });
      const subDepartment = await this.prisma.subDepartment.update({
        where: { id },
        data: {
          name: updateSubDepartmentDto.name,
          headId: updateSubDepartmentDto.headId || null,
        },
      });
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
      });
      await this.cacheManager.del('subdepartments_all');
      await this.cacheManager.del('departments_all');
      return {
        status: true,
        data: subDepartment,
        message: 'Sub-department updated successfully',
      };
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
      });
      return {
        status: false,
        message: 'Failed to update sub-department',
        data: null,
      };
    }
  }

  async deleteSubDepartments(
    subDepartmentIds: string[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const subDepartments = await this.prisma.subDepartment.deleteMany({
        where: { id: { in: subDepartmentIds } },
      });
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
      });
      await this.cacheManager.del('subdepartments_all');
      await this.cacheManager.del('departments_all');
      return {
        status: true,
        data: subDepartments,
        message: 'Sub-departments deleted successfully',
      };
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
      });
      return {
        status: false,
        message: 'Failed to delete sub-departments',
        data: null,
      };
    }
  }

  async deleteSubDepartment(
    id: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.subDepartment.findUnique({
        where: { id },
      });
      const subDepartment = await this.prisma.subDepartment.delete({
        where: { id },
      });
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
      });
      await this.cacheManager.del('subdepartments_all');
      await this.cacheManager.del('departments_all');
      return {
        status: true,
        data: subDepartment,
        message: 'Sub-department deleted successfully',
      };
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
      });
      return {
        status: false,
        message: 'Failed to delete sub-department',
        data: null,
      };
    }
  }
}
