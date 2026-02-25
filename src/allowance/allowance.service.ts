import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import {
  CreateAllowanceDto,
  BulkCreateAllowanceDto,
  UpdateAllowanceDto,
} from './dto/create-allowance.dto';

@Injectable()
export class AllowanceService {
  constructor(
    private prisma: PrismaService,
    private prismaMaster: PrismaMasterService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list(params?: {
    employeeId?: string;
    allowanceHeadId?: string;
    month?: string;
    year?: string;
    status?: string;
  }) {
    try {
      const where: any = {};

      if (params?.employeeId) {
        where.employeeId = params.employeeId;
      }

      if (params?.allowanceHeadId) {
        where.allowanceHeadId = params.allowanceHeadId;
      }

      if (params?.month) {
        where.month = params.month;
      }

      if (params?.year) {
        where.year = params.year;
      }

      if (params?.status) {
        where.status = params.status;
      }

      const allowances = await this.prisma.allowance.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
              accountNumber: true,
              accountTitle: true,
              departmentId: true,
              subDepartmentId: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (allowances.length === 0) {
        return { status: true, data: [] };
      }

      // Collect IDs for Master Data fetching
      const allowanceHeadIds = [
        ...new Set(
          allowances.map((a) => a.allowanceHeadId).filter(Boolean) as string[],
        ),
      ];
      const createdByIds = [
        ...new Set(
          allowances.map((a) => a.createdById).filter(Boolean) as string[],
        ),
      ];
      const deptIds = [
        ...new Set(
          allowances
            .map((a) => a.employee?.departmentId)
            .filter(Boolean) as string[],
        ),
      ];
      const subDeptIds = [
        ...new Set(
          allowances
            .map((a) => a.employee?.subDepartmentId)
            .filter(Boolean) as string[],
        ),
      ];

      const [allowanceHeads, users, departments, subDepartments] =
        await Promise.all([
          this.prisma.allowanceHead.findMany({
            where: { id: { in: allowanceHeadIds } },
            select: { id: true, name: true },
          }),
          this.prismaMaster.user.findMany({
            where: { id: { in: createdByIds } },
            select: { id: true, firstName: true, lastName: true, email: true },
          }),
          this.prisma.department.findMany({
            where: { id: { in: deptIds } },
            select: { id: true, name: true },
          }),
          this.prisma.subDepartment.findMany({
            where: { id: { in: subDeptIds } },
            select: { id: true, name: true },
          }),
        ]);

      const headMap = new Map(allowanceHeads.map((h) => [h.id, h]));
      const userMap = new Map(users.map((u) => [u.id, u]));
      const deptMap = new Map(departments.map((d) => [d.id, d]));
      const subDeptMap = new Map(subDepartments.map((s) => [s.id, s]));

      const mappedData = allowances.map((a) => {
        const emp = a.employee
          ? {
              ...a.employee,
              department: a.employee.departmentId
                ? deptMap.get(a.employee.departmentId)
                : null,
              subDepartment: a.employee.subDepartmentId
                ? subDeptMap.get(a.employee.subDepartmentId)
                : null,
            }
          : null;

        return {
          ...a,
          employee: emp,
          allowanceHead: headMap.get(a.allowanceHeadId) || null,
          createdBy: a.createdById ? userMap.get(a.createdById) : null,
        };
      });

      return { status: true, data: mappedData };
    } catch (error) {
      console.error('Error listing allowances:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to list allowances',
      };
    }
  }

  async get(id: string) {
    try {
      const allowance = await this.prisma.allowance.findUnique({
        where: { id },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
              accountNumber: true,
              accountTitle: true,
              departmentId: true,
              subDepartmentId: true,
            },
          },
        },
      });

      if (!allowance) {
        return { status: false, message: 'Allowance not found' };
      }

      // Fetch Master Data
      const [head, creator, updator, dept, subDept] = await Promise.all([
        this.prisma.allowanceHead.findUnique({
          where: { id: allowance.allowanceHeadId },
          select: { id: true, name: true },
        }),
        allowance.createdById
          ? this.prismaMaster.user.findUnique({
              where: { id: allowance.createdById },
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            })
          : null,
        allowance.updatedById
          ? this.prismaMaster.user.findUnique({
              where: { id: allowance.updatedById },
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            })
          : null,
        allowance.employee?.departmentId
          ? this.prisma.department.findUnique({
              where: { id: allowance.employee.departmentId },
              select: { id: true, name: true },
            })
          : null,
        allowance.employee?.subDepartmentId
          ? this.prisma.subDepartment.findUnique({
              where: { id: allowance.employee.subDepartmentId },
              select: { id: true, name: true },
            })
          : null,
      ]);

      const empMapped = allowance.employee
        ? {
            ...allowance.employee,
            department: dept,
            subDepartment: subDept,
          }
        : null;

      return {
        status: true,
        data: {
          ...allowance,
          employee: empMapped,
          allowanceHead: head,
          createdBy: creator,
          updatedBy: updator,
        },
      };
    } catch (error) {
      console.error('Error getting allowance:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to get allowance',
      };
    }
  }

  async create(
    body: CreateAllowanceDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!body.allowances || body.allowances.length === 0) {
        return {
          status: false,
          message: 'At least one allowance item is required',
        };
      }

      // Validate all employees exist (Tenant)
      const employeeIds = body.allowances.map((a) => a.employeeId);
      const employees = await this.prisma.employee.findMany({
        where: { id: { in: employeeIds } },
        select: { id: true },
      });

      if (employees.length !== employeeIds.length) {
        return { status: false, message: 'One or more employees not found' };
      }

      // Validate all allowance heads exist (Master)
      const allowanceHeadIds = Array.from(
        new Set(body.allowances.map((a) => a.allowanceHeadId)),
      );
      const allowanceHeads = await this.prisma.allowanceHead.findMany({
        where: { id: { in: allowanceHeadIds }, status: 'active' },
        select: { id: true },
      });

      if (allowanceHeads.length !== allowanceHeadIds.length) {
        return {
          status: false,
          message: 'One or more allowance heads not found or inactive',
        };
      }

      const date = new Date(body.date);

      // Create allowances in a transaction
      const result = await this.prisma.$transaction(async (tx) => {
        const createdAllowances: any[] = [];

        for (const allowanceItem of body.allowances) {
          const created = await tx.allowance.create({
            data: {
              employeeId: allowanceItem.employeeId,
              allowanceHeadId: allowanceItem.allowanceHeadId,
              amount: allowanceItem.amount,
              month: body.month,
              year: body.year,
              date: date,
              type:
                allowanceItem.type === 'recurring' ? 'recurring' : 'specific',
              paymentMethod: allowanceItem.paymentMethod || 'with_salary',
              adjustmentMethod: allowanceItem.adjustmentMethod || null,
              isTaxable: allowanceItem.isTaxable ?? false,
              taxPercentage: allowanceItem.taxPercentage
                ? allowanceItem.taxPercentage
                : null,
              notes: allowanceItem.notes ?? null,
              status: 'active',
              createdById: ctx.userId,
            },
          });
          createdAllowances.push(created);
        }

        return createdAllowances;
      });

      // Log activity
      if (result.length > 0 && ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'allowance',
          entity: 'Allowance',
          entityId: result[0].id,
          description: `Created ${result.length} allowance(s) for ${body.month}/${body.year}`,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: result,
        message: `Successfully created ${result.length} allowance(s)`,
      };
    } catch (error) {
      console.error('Error creating allowance:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to create allowance',
      };
    }
  }

  async bulkCreate(
    body: BulkCreateAllowanceDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    return this.create(body, ctx);
  }

  async update(
    id: string,
    body: UpdateAllowanceDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.allowance.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Allowance not found' };
      }

      const updated = await this.prisma.allowance.update({
        where: { id },
        data: {
          ...(body.allowanceHeadId && {
            allowanceHeadId: body.allowanceHeadId,
          }),
          ...(body.amount !== undefined && { amount: body.amount }),
          ...(body.type && { type: body.type }),
          ...(body.paymentMethod && { paymentMethod: body.paymentMethod }),
          ...(body.adjustmentMethod !== undefined && {
            adjustmentMethod: body.adjustmentMethod,
          }),
          ...(body.isTaxable !== undefined && { isTaxable: body.isTaxable }),
          ...(body.taxPercentage !== undefined && {
            taxPercentage: body.taxPercentage,
          }),
          ...(body.notes !== undefined && { notes: body.notes }),
          ...(body.status && { status: body.status }),
          updatedById: ctx.userId,
        },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'allowance',
          entity: 'Allowance',
          entityId: id,
          description: 'Updated allowance',
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: updated,
        message: 'Allowance updated successfully',
      };
    } catch (error) {
      console.error('Error updating allowance:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to update allowance',
      };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.allowance.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Allowance not found' };
      }

      await this.prisma.allowance.delete({
        where: { id },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'allowance',
          entity: 'Allowance',
          entityId: id,
          description: 'Deleted allowance',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return { status: true, message: 'Allowance deleted successfully' };
    } catch (error) {
      console.error('Error deleting allowance:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to delete allowance',
      };
    }
  }

  async bulkDelete(
    ids: string[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!ids || ids.length === 0) {
        return {
          status: false,
          message: 'No allowances selected for deletion',
        };
      }

      const result = await this.prisma.allowance.deleteMany({
        where: { id: { in: ids } },
      });

      // Log activity
      if (ctx.userId && result.count > 0) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'allowance',
          entity: 'Allowance',
          entityId: ids[0],
          description: `Deleted ${result.count} allowance(s)`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        message: `Successfully deleted ${result.count} allowance(s)`,
      };
    } catch (error) {
      console.error('Error bulk deleting allowances:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to delete allowances',
      };
    }
  }

  async listAllowanceHeads(status?: string) {
    try {
      const where: any = {};
      if (status) {
        where.status = status;
      }

      const allowanceHeads = await this.prisma.allowanceHead.findMany({
        where,
        orderBy: { name: 'asc' },
      });

      return { status: true, data: allowanceHeads };
    } catch (error) {
      console.error('Error listing allowance heads:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to list allowance heads',
      };
    }
  }

  async getAllowanceHead(id: string) {
    try {
      const allowanceHead = await this.prisma.allowanceHead.findUnique({
        where: { id },
      });

      if (!allowanceHead) {
        return { status: false, message: 'Allowance head not found' };
      }

      return { status: true, data: allowanceHead };
    } catch (error) {
      console.error('Error getting allowance head:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to get allowance head',
      };
    }
  }
}
