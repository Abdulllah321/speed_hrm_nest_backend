import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { CreateRebateDto, UpdateRebateDto } from './dto/create-rebate.dto';

@Injectable()
export class RebateService {
  constructor(
    private prisma: PrismaService,
    private prismaMaster: PrismaMasterService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list(params?: {
    employeeId?: string;
    rebateNatureId?: string;
    monthYear?: string;
    status?: string;
  }) {
    try {
      const where: any = {};

      if (params?.employeeId) {
        where.employeeId = params.employeeId;
      }

      if (params?.rebateNatureId) {
        where.rebateNatureId = params.rebateNatureId;
      }

      if (params?.monthYear) {
        where.monthYear = params.monthYear;
      }

      if (params?.status) {
        where.status = params.status;
      }

      const rebates = await this.prisma.rebate.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Collect IDs for manual fetching
      const employeeIds = [...new Set(rebates.map((r) => r.employeeId))];
      const rebateNatureIds = [
        ...new Set(rebates.map((r) => r.rebateNatureId)),
      ];
      const createdByUserIds = [
        ...new Set(rebates.map((r) => r.createdById).filter(Boolean)),
      ] as string[];

      // Fetch in parallel
      const [employees, rebateNatures, users] = await Promise.all([
        this.prisma.employee.findMany({
          where: { id: { in: employeeIds } },
          select: {
            id: true,
            employeeId: true,
            employeeName: true,
            bankName: true,
            accountNumber: true,
            accountTitle: true,
            departmentId: true,
            subDepartmentId: true,
          },
        }),
        this.prisma.rebateNature.findMany({
          where: { id: { in: rebateNatureIds } },
          select: { id: true, name: true, type: true, category: true },
        }),
        this.prismaMaster.user.findMany({
          where: { id: { in: createdByUserIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        }),
      ]);

      // Fetch Dept/SubDept labels for employees
      const deptIds = [
        ...new Set(employees.map((e) => e.departmentId).filter(Boolean)),
      ] as string[];
      const subDeptIds = [
        ...new Set(employees.map((e) => e.subDepartmentId).filter(Boolean)),
      ] as string[];

      const [departments, subDepartments] = await Promise.all([
        this.prisma.department.findMany({
          where: { id: { in: deptIds } },
          select: { id: true, name: true },
        }),
        this.prisma.subDepartment.findMany({
          where: { id: { in: subDeptIds } },
          select: { id: true, name: true },
        }),
      ]);

      const deptMap = new Map(departments.map((d) => [d.id, d]));
      const subDeptMap = new Map(subDepartments.map((sd) => [sd.id, sd]));
      const employeeMap = new Map(
        employees.map((e) => [
          e.id,
          {
            ...e,
            department: e.departmentId ? deptMap.get(e.departmentId) : null,
            subDepartment: e.subDepartmentId
              ? subDeptMap.get(e.subDepartmentId)
              : null,
          },
        ]),
      );
      const natureMap = new Map(rebateNatures.map((rn) => [rn.id, rn]));
      const userMap = new Map(users.map((u) => [u.id, u]));

      const mapped = rebates.map((r) => ({
        ...r,
        employee: employeeMap.get(r.employeeId) || null,
        rebateNature: natureMap.get(r.rebateNatureId) || null,
        createdBy: r.createdById ? userMap.get(r.createdById) : null,
      }));

      return { status: true, data: mapped };
    } catch (error) {
      console.error('Error listing rebates:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to list rebates',
      };
    }
  }

  async get(id: string) {
    try {
      const rebate = await this.prisma.rebate.findUnique({
        where: { id },
      });

      if (!rebate) {
        return { status: false, message: 'Rebate not found' };
      }

      // Fetch related data
      const [employee, rebateNature, createdBy] = await Promise.all([
        this.prisma.employee.findUnique({
          where: { id: rebate.employeeId },
          select: {
            id: true,
            employeeId: true,
            employeeName: true,
            bankName: true,
            accountNumber: true,
            accountTitle: true,
            departmentId: true,
            subDepartmentId: true,
          },
        }),
        this.prisma.rebateNature.findUnique({
          where: { id: rebate.rebateNatureId },
          select: {
            id: true,
            name: true,
            type: true,
            category: true,
            maxInvestmentPercentage: true,
            maxInvestmentAmount: true,
            details: true,
            underSection: true,
          },
        }),
        rebate.createdById
          ? this.prismaMaster.user.findUnique({
              where: { id: rebate.createdById },
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            })
          : Promise.resolve(null),
      ]);

      let employeeWithLabels: any = null;
      if (employee) {
        const [dept, subDept] = await Promise.all([
          employee.departmentId
            ? this.prisma.department.findUnique({
                where: { id: employee.departmentId },
                select: { id: true, name: true },
              })
            : Promise.resolve(null),
          employee.subDepartmentId
            ? this.prisma.subDepartment.findUnique({
                where: { id: employee.subDepartmentId },
                select: { id: true, name: true },
              })
            : Promise.resolve(null),
        ]);
        employeeWithLabels = {
          ...employee,
          department: dept,
          subDepartment: subDept,
        };
      }

      return {
        status: true,
        data: {
          ...rebate,
          employee: employeeWithLabels,
          rebateNature,
          createdBy,
        },
      };
    } catch (error) {
      console.error('Error getting rebate:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to get rebate',
      };
    }
  }

  async create(
    body: CreateRebateDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      // Validate employee exists
      const employee = await this.prisma.employee.findUnique({
        where: { id: body.employeeId },
      });

      if (!employee) {
        return { status: false, message: 'Employee not found' };
      }

      // Validate rebate nature exists (in Master DB)
      const rebateNature = await this.prisma.rebateNature.findUnique({
        where: { id: body.rebateNatureId },
      });

      if (!rebateNature) {
        return { status: false, message: 'Rebate nature not found' };
      }

      // Validate monthYear format
      if (!/^""d{4}-""d{2}$/.test(body.monthYear)) {
        return {
          status: false,
          message: 'Invalid monthYear format. Expected YYYY-MM',
        };
      }

      // Check for duplicate (employee, rebateNature, monthYear combination)
      const existing = await this.prisma.rebate.findUnique({
        where: {
          employeeId_rebateNatureId_monthYear: {
            employeeId: body.employeeId,
            rebateNatureId: body.rebateNatureId,
            monthYear: body.monthYear,
          },
        },
      });

      if (existing) {
        return {
          status: false,
          message:
            'Rebate already exists for this employee, rebate nature, and month/year combination',
        };
      }

      // Create rebate
      const rebate = await this.prisma.rebate.create({
        data: {
          employeeId: body.employeeId,
          rebateNatureId: body.rebateNatureId,
          rebateAmount: body.rebateAmount,
          monthYear: body.monthYear,
          attachment: body.attachment || null,
          remarks: body.remarks || null,
          status: 'pending',
          createdById: ctx.userId,
        },
      });

      // Map relation data for response
      const [dept, subDept] = await Promise.all([
        employee.departmentId
          ? this.prisma.department.findUnique({
              where: { id: employee.departmentId },
              select: { id: true, name: true },
            })
          : Promise.resolve(null),
        employee.subDepartmentId
          ? this.prisma.subDepartment.findUnique({
              where: { id: employee.subDepartmentId },
              select: { id: true, name: true },
            })
          : Promise.resolve(null),
      ]);

      const mappedRebate = {
        ...rebate,
        employee: {
          ...employee,
          department: dept,
          subDepartment: subDept,
        },
        rebateNature: {
          id: rebateNature.id,
          name: rebateNature.name,
          type: rebateNature.type,
          category: rebateNature.category,
        },
      };

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'rebate',
          entity: 'Rebate',
          entityId: rebate.id,
          description: `Created rebate for ${employee.employeeName} - ${rebateNature.name}`,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: mappedRebate,
        message: 'Rebate created successfully',
      };
    } catch (error) {
      console.error('Error creating rebate:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to create rebate',
      };
    }
  }

  async update(
    id: string,
    body: UpdateRebateDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.rebate.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Rebate not found' };
      }

      // Validate employee if provided
      let employee: any = null;
      if (body.employeeId) {
        employee = await this.prisma.employee.findUnique({
          where: { id: body.employeeId },
        });
        if (!employee) {
          return { status: false, message: 'Employee not found' };
        }
      } else {
        employee = await this.prisma.employee.findUnique({
          where: { id: existing.employeeId },
        });
      }

      // Validate rebate nature if provided (in Master DB)
      let rebateNature: any = null;
      if (body.rebateNatureId) {
        rebateNature = await this.prisma.rebateNature.findUnique({
          where: { id: body.rebateNatureId },
        });
        if (!rebateNature) {
          return { status: false, message: 'Rebate nature not found' };
        }
      } else {
        rebateNature = await this.prisma.rebateNature.findUnique({
          where: { id: existing.rebateNatureId },
        });
      }

      // Validate monthYear format if provided
      if (body.monthYear && !/^""d{4}-""d{2}$/.test(body.monthYear)) {
        return {
          status: false,
          message: 'Invalid monthYear format. Expected YYYY-MM',
        };
      }

      // Check for duplicate if employeeId, rebateNatureId, or monthYear changed
      if (body.employeeId || body.rebateNatureId || body.monthYear) {
        const employeeId = body.employeeId || existing.employeeId;
        const rebateNatureId = body.rebateNatureId || existing.rebateNatureId;
        const monthYear = body.monthYear || existing.monthYear;

        const duplicate = await this.prisma.rebate.findUnique({
          where: {
            employeeId_rebateNatureId_monthYear: {
              employeeId,
              rebateNatureId,
              monthYear,
            },
          },
        });

        if (duplicate && duplicate.id !== id) {
          return {
            status: false,
            message:
              'Another rebate already exists for this employee, rebate nature, and month/year combination',
          };
        }
      }

      // Prepare update data
      const updateData: any = {};
      if (body.employeeId) updateData.employeeId = body.employeeId;
      if (body.rebateNatureId) updateData.rebateNatureId = body.rebateNatureId;
      if (body.rebateAmount !== undefined)
        updateData.rebateAmount = body.rebateAmount;
      if (body.monthYear) updateData.monthYear = body.monthYear;
      if (body.remarks !== undefined) updateData.remarks = body.remarks;
      if (body.status) updateData.status = body.status;
      if (body.attachment !== undefined)
        updateData.attachment = body.attachment || null;

      const updated = await this.prisma.rebate.update({
        where: { id },
        data: updateData,
      });

      // Map relation data for response
      const [dept, subDept] = await Promise.all([
        employee?.departmentId
          ? this.prisma.department.findUnique({
              where: { id: employee.departmentId },
              select: { id: true, name: true },
            })
          : Promise.resolve(null),
        employee?.subDepartmentId
          ? this.prisma.subDepartment.findUnique({
              where: { id: employee.subDepartmentId },
              select: { id: true, name: true },
            })
          : Promise.resolve(null),
      ]);

      const mappedUpdated = {
        ...updated,
        employee: employee
          ? {
              ...employee,
              department: dept,
              subDepartment: subDept,
            }
          : null,
        rebateNature: rebateNature
          ? {
              id: rebateNature.id,
              name: rebateNature.name,
              type: rebateNature.type,
              category: rebateNature.category,
            }
          : null,
      };

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'rebate',
          entity: 'Rebate',
          entityId: id,
          description: 'Updated rebate',
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: mappedUpdated,
        message: 'Rebate updated successfully',
      };
    } catch (error) {
      console.error('Error updating rebate:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to update rebate',
      };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.rebate.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Rebate not found' };
      }

      await this.prisma.rebate.delete({
        where: { id },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'rebate',
          entity: 'Rebate',
          entityId: id,
          description: 'Deleted rebate',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return { status: true, message: 'Rebate deleted successfully' };
    } catch (error) {
      console.error('Error deleting rebate:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to delete rebate',
      };
    }
  }
}
