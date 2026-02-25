import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import {
  BulkCreateIncrementDto,
  UpdateIncrementDto,
} from './dto/create-increment.dto';

@Injectable()
export class IncrementService {
  constructor(
    private prisma: PrismaService,
    private prismaMaster: PrismaMasterService,
    private activityLogs: ActivityLogsService,
  ) {}

  private async enrichSingleIncrement(increment: any) {
    if (!increment) return null;

    const [
      grade,
      designation,
      department,
      subDepartment,
      createdBy,
      updatedBy,
    ] = await Promise.all([
      increment.employeeGradeId
        ? this.prisma.employeeGrade.findUnique({
            where: { id: increment.employeeGradeId },
            select: { id: true, grade: true },
          })
        : null,
      increment.designationId
        ? this.prisma.designation.findUnique({
            where: { id: increment.designationId },
            select: { id: true, name: true },
          })
        : null,
      increment.employee?.departmentId
        ? this.prisma.department.findUnique({
            where: { id: increment.employee.departmentId },
            select: { id: true, name: true },
          })
        : null,
      increment.employee?.subDepartmentId
        ? this.prisma.subDepartment.findUnique({
            where: { id: increment.employee.subDepartmentId },
            select: { id: true, name: true },
          })
        : null,
      increment.createdById
        ? this.prismaMaster.user.findUnique({
            where: { id: increment.createdById },
            select: { id: true, firstName: true, lastName: true, email: true },
          })
        : null,
      increment.updatedById
        ? this.prismaMaster.user.findUnique({
            where: { id: increment.updatedById },
            select: { id: true, firstName: true, lastName: true, email: true },
          })
        : null,
    ]);

    return {
      ...increment,
      employeeName: increment.employee?.employeeName,
      employeeCode: increment.employee?.employeeId,
      employeeGradeName: grade?.grade,
      designationName: designation?.name,
      department: department?.name,
      subDepartment: subDepartment?.name,
      incrementAmount: increment.incrementAmount
        ? Number(increment.incrementAmount)
        : undefined,
      incrementPercentage: increment.incrementPercentage
        ? Number(increment.incrementPercentage)
        : undefined,
      salary: Number(increment.salary),
      promotionDate: increment.promotionDate.toISOString(),
      createdAt: increment.createdAt.toISOString(),
      updatedAt: increment.updatedAt.toISOString(),
      createdBy,
      updatedBy,
    };
  }

  async list(params?: { employeeId?: string; month?: string; year?: string }) {
    try {
      const where: any = {};

      if (params?.employeeId) {
        where.employeeId = params.employeeId;
      }

      if (params?.month) {
        where.currentMonth = params.month;
      }

      if (params?.year) {
        // Extract year from promotionDate
        const startOfYear = new Date(`${params.year}-01-01`);
        const endOfYear = new Date(`${params.year}-12-31`);
        where.promotionDate = {
          gte: startOfYear,
          lte: endOfYear,
        };
      }

      const increments = await this.prisma.increment.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
              departmentId: true,
              subDepartmentId: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (increments.length === 0) {
        return { status: true, data: [] };
      }

      // Collect IDs for Master DB fetching
      const employeeGradeIds = [
        ...new Set(increments.map((i) => i.employeeGradeId).filter(Boolean)),
      ] as string[];
      const designationIds = [
        ...new Set(increments.map((i) => i.designationId).filter(Boolean)),
      ] as string[];
      const departmentIds = [
        ...new Set(
          increments.map((i) => i.employee?.departmentId).filter(Boolean),
        ),
      ] as string[];
      const subDepartmentIds = [
        ...new Set(
          increments.map((i) => i.employee?.subDepartmentId).filter(Boolean),
        ),
      ] as string[];

      // Fetch from Master DB
      const [grades, designations, departments, subDepartments] =
        await Promise.all([
          employeeGradeIds.length
            ? this.prisma.employeeGrade.findMany({
                where: { id: { in: employeeGradeIds } },
                select: { id: true, grade: true },
              })
            : [],
          designationIds.length
            ? this.prisma.designation.findMany({
                where: { id: { in: designationIds } },
                select: { id: true, name: true },
              })
            : [],
          departmentIds.length
            ? this.prisma.department.findMany({
                where: { id: { in: departmentIds } },
                select: { id: true, name: true },
              })
            : [],
          subDepartmentIds.length
            ? this.prisma.subDepartment.findMany({
                where: { id: { in: subDepartmentIds } },
                select: { id: true, name: true },
              })
            : [],
        ]);

      // Create lookup maps
      const gradeMap = new Map<string, any>(
        grades.map((g) => [g.id, g] as [string, any]),
      );
      const designationMap = new Map<string, any>(
        designations.map((d) => [d.id, d] as [string, any]),
      );
      const departmentMap = new Map<string, any>(
        departments.map((d) => [d.id, d] as [string, any]),
      );
      const subDepartmentMap = new Map<string, any>(
        subDepartments.map((d) => [d.id, d] as [string, any]),
      );

      // Transform data to match frontend expectations
      const transformedData = increments.map((increment) => {
        const grade = increment.employeeGradeId
          ? gradeMap.get(increment.employeeGradeId)
          : null;
        const designation = increment.designationId
          ? designationMap.get(increment.designationId)
          : null;
        const dept = increment.employee?.departmentId
          ? departmentMap.get(increment.employee.departmentId)
          : null;
        const subDept = increment.employee?.subDepartmentId
          ? subDepartmentMap.get(increment.employee.subDepartmentId)
          : null;

        return {
          id: increment.id,
          employeeId: increment.employeeId,
          employeeName: increment.employee?.employeeName,
          employeeCode: increment.employee?.employeeId,
          employeeGradeId: increment.employeeGradeId,
          employeeGradeName: grade?.grade,
          designationId: increment.designationId,
          designationName: designation?.name,
          department: dept?.name,
          subDepartment: subDept?.name,
          incrementType: increment.incrementType,
          incrementAmount: increment.incrementAmount
            ? Number(increment.incrementAmount)
            : undefined,
          incrementPercentage: increment.incrementPercentage
            ? Number(increment.incrementPercentage)
            : undefined,
          incrementMethod: increment.incrementMethod,
          salary: Number(increment.salary),
          promotionDate: increment.promotionDate.toISOString(),
          currentMonth: increment.currentMonth,
          monthsOfIncrement: increment.monthsOfIncrement,
          notes: increment.notes,
          status: increment.status,
          createdById: increment.createdById,
          createdAt: increment.createdAt.toISOString(),
          updatedAt: increment.updatedAt.toISOString(),
        };
      });

      return { status: true, data: transformedData };
    } catch (error) {
      console.error('Error listing increments:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to list increments',
      };
    }
  }

  async get(id: string) {
    try {
      const increment = await this.prisma.increment.findUnique({
        where: { id },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
              departmentId: true,
              subDepartmentId: true,
            },
          },
        },
      });

      if (!increment) {
        return { status: false, message: 'Increment not found' };
      }

      const enriched = await this.enrichSingleIncrement(increment);

      return { status: true, data: enriched };
    } catch (error) {
      console.error('Error getting increment:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to get increment',
      };
    }
  }

  async bulkCreate(
    body: BulkCreateIncrementDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!body.increments || body.increments.length === 0) {
        return {
          status: false,
          message: 'At least one increment item is required',
        };
      }

      // Validate all employees exist
      const employeeIds = body.increments.map((i) => i.employeeId);
      const employees = await this.prisma.employee.findMany({
        where: { id: { in: employeeIds } },
        select: { id: true },
      });

      if (employees.length !== employeeIds.length) {
        return { status: false, message: 'One or more employees not found' };
      }

      // Validate employee grades if provided
      const employeeGradeIds = body.increments
        .map((i) => i.employeeGradeId)
        .filter((id): id is string => !!id);
      if (employeeGradeIds.length > 0) {
        const uniqueGradeIds = [...new Set(employeeGradeIds)];
        const employeeGrades = await this.prisma.employeeGrade.findMany({
          where: { id: { in: uniqueGradeIds }, status: 'active' },
          select: { id: true },
        });

        if (employeeGrades.length !== uniqueGradeIds.length) {
          return {
            status: false,
            message: 'One or more employee grades not found or inactive',
          };
        }
      }

      // Validate designations if provided
      const designationIds = body.increments
        .map((i) => i.designationId)
        .filter((id): id is string => !!id);
      if (designationIds.length > 0) {
        const uniqueDesignationIds = [...new Set(designationIds)];
        const designations = await this.prisma.designation.findMany({
          where: { id: { in: uniqueDesignationIds }, status: 'active' },
          select: { id: true },
        });

        if (designations.length !== uniqueDesignationIds.length) {
          return {
            status: false,
            message: 'One or more designations not found or inactive',
          };
        }
      }

      // Create increments in a transaction
      const result = await this.prisma.$transaction(async (tx) => {
        const createdIncrements: any[] = [];

        for (const incrementItem of body.increments) {
          const promotionDate = new Date(incrementItem.promotionDate);

          const created = await tx.increment.create({
            data: {
              employeeId: incrementItem.employeeId,
              employeeGradeId: incrementItem.employeeGradeId || null,
              designationId: incrementItem.designationId || null,
              incrementType: incrementItem.incrementType,
              incrementAmount: incrementItem.incrementAmount
                ? incrementItem.incrementAmount
                : null,
              incrementPercentage: incrementItem.incrementPercentage
                ? incrementItem.incrementPercentage
                : null,
              incrementMethod: incrementItem.incrementMethod,
              salary: incrementItem.salary,
              promotionDate: promotionDate,
              currentMonth: incrementItem.currentMonth,
              monthsOfIncrement: incrementItem.monthsOfIncrement,
              notes: incrementItem.notes || null,
              status: 'active',
              createdById: ctx.userId,
            },
            include: {
              employee: {
                select: {
                  id: true,
                  employeeId: true,
                  employeeName: true,
                  departmentId: true,
                  subDepartmentId: true,
                },
              },
            },
          });
          createdIncrements.push(created);
        }

        return createdIncrements;
      });

      // Enrich result with Master data
      const enrichedResult = await Promise.all(
        result.map((i) => this.enrichSingleIncrement(i)),
      );

      // Log activity
      if (result.length > 0 && ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'increment',
          entity: 'Increment',
          entityId: result[0].id,
          description: `Created ${result.length} increment(s)`,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: enrichedResult,
        message: `Successfully created ${result.length} increment(s)`,
      };
    } catch (error) {
      console.error('Error creating increments:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to create increments',
      };
    }
  }

  async update(
    id: string,
    body: UpdateIncrementDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.increment.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Increment not found' };
      }

      // Validate employee grade if being updated
      if (
        body.employeeGradeId &&
        body.employeeGradeId !== existing.employeeGradeId
      ) {
        const employeeGrade = await this.prisma.employeeGrade.findUnique({
          where: { id: body.employeeGradeId },
          select: { id: true, status: true },
        });

        if (!employeeGrade || employeeGrade.status !== 'active') {
          return {
            status: false,
            message: 'Employee grade not found or inactive',
          };
        }
      }

      // Validate designation if being updated
      if (body.designationId && body.designationId !== existing.designationId) {
        const designation = await this.prisma.designation.findUnique({
          where: { id: body.designationId },
          select: { id: true, status: true },
        });

        if (!designation || designation.status !== 'active') {
          return {
            status: false,
            message: 'Designation not found or inactive',
          };
        }
      }

      const updateData: any = {};
      if (body.employeeGradeId !== undefined)
        updateData.employeeGradeId = body.employeeGradeId || null;
      if (body.designationId !== undefined)
        updateData.designationId = body.designationId || null;
      if (body.incrementType) updateData.incrementType = body.incrementType;
      if (body.incrementAmount !== undefined)
        updateData.incrementAmount = body.incrementAmount || null;
      if (body.incrementPercentage !== undefined)
        updateData.incrementPercentage = body.incrementPercentage || null;
      if (body.incrementMethod)
        updateData.incrementMethod = body.incrementMethod;
      if (body.salary !== undefined) updateData.salary = body.salary;
      if (body.promotionDate)
        updateData.promotionDate = new Date(body.promotionDate);
      if (body.currentMonth) updateData.currentMonth = body.currentMonth;
      if (body.monthsOfIncrement !== undefined)
        updateData.monthsOfIncrement = body.monthsOfIncrement;
      if (body.notes !== undefined) updateData.notes = body.notes || null;
      if (body.status) updateData.status = body.status;
      updateData.updatedById = ctx.userId;

      const updated = await this.prisma.increment.update({
        where: { id },
        data: updateData,
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
              departmentId: true,
              subDepartmentId: true,
            },
          },
        },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'increment',
          entity: 'Increment',
          entityId: id,
          description: 'Updated increment',
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      const enriched = await this.enrichSingleIncrement(updated);

      return {
        status: true,
        data: enriched,
        message: 'Increment updated successfully',
      };
    } catch (error) {
      console.error('Error updating increment:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to update increment',
      };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.increment.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Increment not found' };
      }

      await this.prisma.increment.delete({
        where: { id },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'increment',
          entity: 'Increment',
          entityId: id,
          description: 'Deleted increment',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return { status: true, message: 'Increment deleted successfully' };
    } catch (error) {
      console.error('Error deleting increment:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to delete increment',
      };
    }
  }
}
