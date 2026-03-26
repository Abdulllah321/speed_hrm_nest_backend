import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import {
  CreateBonusDto,
  BulkCreateBonusDto,
  UpdateBonusDto,
} from './dto/create-bonus.dto';

@Injectable()
export class BonusService {
  constructor(
    private prisma: PrismaService,
    private prismaMaster: PrismaMasterService,
    private activityLogs: ActivityLogsService,
  ) {}

  private async enrichSingleBonus(bonus: any) {
    if (!bonus) return null;

    const [bonusType, department, subDepartment, createdBy, updatedBy] =
      await Promise.all([
        bonus.bonusTypeId
          ? this.prisma.bonusType.findUnique({
              where: { id: bonus.bonusTypeId },
              select: { id: true, name: true, calculationType: true },
            })
          : null,
        bonus.employee?.departmentId
          ? this.prisma.department.findUnique({
              where: { id: bonus.employee.departmentId },
              select: { id: true, name: true },
            })
          : null,
        bonus.employee?.subDepartmentId
          ? this.prisma.subDepartment.findUnique({
              where: { id: bonus.employee.subDepartmentId },
              select: { id: true, name: true },
            })
          : null,
        bonus.createdById
          ? this.prismaMaster.user.findUnique({
              where: { id: bonus.createdById },
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            })
          : null,
        bonus.updatedById
          ? this.prismaMaster.user.findUnique({
              where: { id: bonus.updatedById },
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            })
          : null,
      ]);

    return {
      ...bonus,
      employee: bonus.employee
        ? {
            ...bonus.employee,
            department,
            subDepartment,
          }
        : null,
      bonusType,
      createdBy,
      updatedBy,
    };
  }

  async list(params?: {
    employeeId?: string;
    bonusTypeId?: string;
    month?: string;
    year?: string;
    bonusMonthYear?: string;
    status?: string;
  }) {
    try {
      const where: any = {};

      if (params?.employeeId) {
        where.employeeId = params.employeeId;
      }

      if (params?.bonusTypeId) {
        where.bonusTypeId = params.bonusTypeId;
      }

      if (params?.month) {
        where.bonusMonth = params.month;
      }

      if (params?.year) {
        where.bonusYear = params.year;
      }

      if (params?.bonusMonthYear) {
        where.bonusMonthYear = params.bonusMonthYear;
      }

      if (params?.status) {
        where.status = params.status;
      }

      const bonuses = await this.prisma.bonus.findMany({
        where,
        include: {
          employee: {
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
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (bonuses.length === 0) {
        return { status: true, data: [] };
      }

      // Collect Master IDs
      const bonusTypeIds = [
        ...new Set(bonuses.map((b) => b.bonusTypeId).filter(Boolean)),
      ] as string[];
      const deptIds = [
        ...new Set(
          bonuses.map((b) => b.employee?.departmentId).filter(Boolean),
        ),
      ] as string[];
      const subDeptIds = [
        ...new Set(
          bonuses.map((b) => b.employee?.subDepartmentId).filter(Boolean),
        ),
      ] as string[];
      const userIds = [
        ...new Set(
          [
            ...bonuses.map((b) => b.createdById),
            ...bonuses.map((b) => b.updatedById),
          ].filter(Boolean),
        ),
      ] as string[];

      const [bonusTypes, departments, subDepartments, users] =
        await Promise.all([
          this.prisma.bonusType.findMany({
            where: { id: { in: bonusTypeIds } },
            select: { id: true, name: true, calculationType: true },
          }),
          this.prisma.department.findMany({
            where: { id: { in: deptIds } },
            select: { id: true, name: true },
          }),
          this.prisma.subDepartment.findMany({
            where: { id: { in: subDeptIds } },
            select: { id: true, name: true },
          }),
          this.prismaMaster.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, firstName: true, lastName: true, email: true },
          }),
        ]);

      const bonusTypeMap = new Map(bonusTypes.map((bt) => [bt.id, bt]));
      const deptMap = new Map(departments.map((d) => [d.id, d]));
      const subDeptMap = new Map(subDepartments.map((sd) => [sd.id, sd]));
      const userMap = new Map(users.map((u) => [u.id, u]));

      const enriched = bonuses.map((b) => {
        const bonus = b as any;
        return {
          ...bonus,
          employee: bonus.employee
            ? {
                ...bonus.employee,
                department: deptMap.get(bonus.employee.departmentId) || null,
                subDepartment:
                  subDeptMap.get(bonus.employee.subDepartmentId) || null,
              }
            : null,
          bonusType: bonusTypeMap.get(bonus.bonusTypeId) || null,
          createdBy: userMap.get(bonus.createdById) || null,
          updatedBy: userMap.get(bonus.updatedById) || null,
        };
      });

      return { status: true, data: enriched };
    } catch (error) {
      console.error('Error listing bonuses:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to list bonuses',
      };
    }
  }

  async get(id: string) {
    try {
      const bonus = await this.prisma.bonus.findUnique({
        where: { id },
        include: {
          employee: {
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
          },
        },
      });

      if (!bonus) {
        return { status: false, message: 'Bonus not found' };
      }

      const enriched = await this.enrichSingleBonus(bonus);

      return { status: true, data: enriched };
    } catch (error) {
      console.error('Error getting bonus:', error);
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Failed to get bonus',
      };
    }
  }

  async create(
    body: CreateBonusDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!body.bonuses || body.bonuses.length === 0) {
        return {
          status: false,
          message: 'At least one bonus item is required',
        };
      }

      // Validate all employees exist
      const employeeIds = body.bonuses.map((b) => b.employeeId);
      const employees = await this.prisma.employee.findMany({
        where: { id: { in: employeeIds } },
        select: { id: true, employeeSalary: true },
      });

      if (employees.length !== employeeIds.length) {
        return { status: false, message: 'One or more employees not found' };
      }

      // Validate bonus type exists (IN MASTER DB)
      const bonusType = await this.prisma.bonusType.findUnique({
        where: { id: body.bonusTypeId },
      });

      if (!bonusType) {
        return { status: false, message: 'Bonus type not found' };
      }

      const [year, month] = body.bonusMonthYear.split('-');
      const paymentMethod = body.paymentMethod || 'with_salary';
      const adjustmentMethod =
        body.adjustmentMethod || 'distributed-remaining-months';

      // Validate payment method
      if (
        paymentMethod &&
        !['with_salary', 'separately'].includes(paymentMethod)
      ) {
        throw new BadRequestException(
          'Invalid paymentMethod. Must be "with_salary" or "separately"',
        );
      }

      // Validate adjustment method
      if (
        adjustmentMethod &&
        !['distributed-remaining-months', 'deduct-current-month'].includes(
          adjustmentMethod,
        )
      ) {
        throw new BadRequestException(
          'Invalid adjustmentMethod. Must be "distributed-remaining-months" or "deduct-current-month"',
        );
      }

      // Create bonuses in a transaction
      const result = await this.prisma.$transaction(async (tx) => {
        const createdBonuses: any[] = [];

        for (const bonusItem of body.bonuses) {
          const employee = employees.find((e) => e.id === bonusItem.employeeId);

          // Calculate amount based on bonus type
          let calculatedAmount = bonusItem.amount;
          if (
            bonusType.calculationType === 'Percentage' &&
            bonusItem.percentage
          ) {
            const salary = employee?.employeeSalary
              ? Number(employee.employeeSalary)
              : 0;
            calculatedAmount = (salary * Number(bonusItem.percentage)) / 100;
          }

          // Check for existing bonus
          const existing = await tx.bonus.findUnique({
            where: {
              employeeId_bonusTypeId_bonusMonthYear: {
                employeeId: bonusItem.employeeId,
                bonusTypeId: body.bonusTypeId,
                bonusMonthYear: body.bonusMonthYear,
              },
            },
          });

          if (existing) {
            // Handle adjustment method
            let finalAmount = calculatedAmount;
            if (adjustmentMethod === 'distributed-remaining-months') {
              // For distributed: keep the existing amount, new bonus will be distributed
              finalAmount = Number(existing.amount) + calculatedAmount;
            } else if (adjustmentMethod === 'deduct-current-month') {
              // For deduct: subtract from existing amount
              finalAmount = Math.max(
                0,
                Number(existing.amount) - calculatedAmount,
              );
            } else {
              // Fallback to add behavior
              finalAmount = Number(existing.amount) + calculatedAmount;
            }

            const updated = await tx.bonus.update({
              where: { id: existing.id },
              data: {
                amount: finalAmount,
                percentage: bonusItem.percentage
                  ? Number(bonusItem.percentage)
                  : null,
                paymentMethod,
                adjustmentMethod,
                notes: body.notes ?? null,
                isTaxable: bonusItem.isTaxable ?? false,
                taxPercentage: bonusItem.taxPercentage ?? null,
                updatedById: ctx.userId,
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
            createdBonuses.push(updated);
          } else {
            // Create new
            const created = await tx.bonus.create({
              data: {
                employeeId: bonusItem.employeeId,
                bonusTypeId: body.bonusTypeId,
                amount: calculatedAmount,
                calculationType: bonusType.calculationType,
                percentage: bonusItem.percentage
                  ? Number(bonusItem.percentage)
                  : null,
                bonusMonth: month,
                bonusYear: year,
                bonusMonthYear: body.bonusMonthYear,
                paymentMethod,
                adjustmentMethod,
                notes: body.notes ?? null,
                isTaxable: bonusItem.isTaxable ?? false,
                taxPercentage: bonusItem.taxPercentage ?? null,
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
            createdBonuses.push(created);
          }
        }

        return createdBonuses;
      });

      // Enrich results with Master data
      const enrichedResults = await Promise.all(
        result.map((b) => this.enrichSingleBonus(b)),
      );

      // Log activity
      if (result.length > 0 && ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'bonus',
          entity: 'Bonus',
          entityId: result[0].id,
          description: `Created ${result.length} bonus(es) for ${body.bonusMonthYear}`,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: enrichedResults,
        message: `Successfully created ${result.length} bonus(es)`,
      };
    } catch (error) {
      console.error('Error creating bonus:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to create bonus',
      };
    }
  }

  async bulkCreate(
    body: BulkCreateBonusDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    return this.create(body, ctx);
  }

  async update(
    id: string,
    body: UpdateBonusDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.bonus.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Bonus not found' };
      }

      // Validate paymentMethod if provided
      if (
        body.paymentMethod &&
        !['with_salary', 'separately'].includes(body.paymentMethod)
      ) {
        throw new BadRequestException(
          'Invalid paymentMethod. Must be "with_salary" or "separately"',
        );
      }

      // Validate adjustmentMethod if provided
      if (
        body.adjustmentMethod &&
        !['distributed-remaining-months', 'deduct-current-month'].includes(
          body.adjustmentMethod,
        )
      ) {
        throw new BadRequestException(
          'Invalid adjustmentMethod. Must be "distributed-remaining-months" or "deduct-current-month"',
        );
      }

      const updated = await this.prisma.bonus.update({
        where: { id },
        data: {
          ...(body.bonusTypeId && { bonusTypeId: body.bonusTypeId }),
          ...(body.amount !== undefined && { amount: body.amount }),
          ...(body.percentage !== undefined && { percentage: body.percentage }),
          ...(body.paymentMethod && { paymentMethod: body.paymentMethod }),
          ...(body.adjustmentMethod && {
            adjustmentMethod: body.adjustmentMethod,
          }),
          ...(body.notes !== undefined && { notes: body.notes }),
          ...(body.isTaxable !== undefined && { isTaxable: body.isTaxable }),
          ...(body.taxPercentage !== undefined && {
            taxPercentage: body.taxPercentage,
          }),
          ...(body.status && { status: body.status }),
          updatedById: ctx.userId,
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

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'bonus',
          entity: 'Bonus',
          entityId: id,
          description: 'Updated bonus',
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      const enriched = await this.enrichSingleBonus(updated);

      return {
        status: true,
        data: enriched,
        message: 'Bonus updated successfully',
      };
    } catch (error) {
      console.error('Error updating bonus:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to update bonus',
      };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.bonus.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Bonus not found' };
      }

      await this.prisma.bonus.delete({
        where: { id },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'bonus',
          entity: 'Bonus',
          entityId: id,
          description: 'Deleted bonus',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return { status: true, message: 'Bonus deleted successfully' };
    } catch (error) {
      console.error('Error deleting bonus:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to delete bonus',
      };
    }
  }

  async searchByEmployees(params: {
    employeeIds: string[];
    bonusMonthYear?: string;
    bonusTypeId?: string;
  }) {
    try {
      const where: any = {
        employeeId: { in: params.employeeIds },
      };

      if (params.bonusMonthYear) {
        where.bonusMonthYear = params.bonusMonthYear;
      }

      if (params.bonusTypeId) {
        where.bonusTypeId = params.bonusTypeId;
      }

      const bonuses = await this.prisma.bonus.findMany({
        where,
        include: {
          employee: {
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
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (bonuses.length === 0) {
        return { status: true, data: {} };
      }

      // Collect Master IDs
      const bonusTypeIds = [
        ...new Set(bonuses.map((b) => b.bonusTypeId).filter(Boolean)),
      ] as string[];
      const deptIds = [
        ...new Set(
          bonuses.map((b) => b.employee?.departmentId).filter(Boolean),
        ),
      ] as string[];
      const subDeptIds = [
        ...new Set(
          bonuses.map((b) => b.employee?.subDepartmentId).filter(Boolean),
        ),
      ] as string[];

      const [bonusTypes, departments, subDepartments] = await Promise.all([
        this.prisma.bonusType.findMany({
          where: { id: { in: bonusTypeIds } },
          select: { id: true, name: true, calculationType: true },
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

      const bonusTypeMap = new Map(bonusTypes.map((bt) => [bt.id, bt]));
      const deptMap = new Map(departments.map((d) => [d.id, d]));
      const subDeptMap = new Map(subDepartments.map((sd) => [sd.id, sd]));

      // Group by employee and enrich
      const groupedByEmployee: { [key: string]: any[] } = {};
      bonuses.forEach((b) => {
        const bonus = b as any;
        const enriched = {
          ...bonus,
          employee: bonus.employee
            ? {
                ...bonus.employee,
                department: deptMap.get(bonus.employee.departmentId) || null,
                subDepartment:
                  subDeptMap.get(bonus.employee.subDepartmentId) || null,
              }
            : null,
          bonusType: bonusTypeMap.get(bonus.bonusTypeId) || null,
        };

        if (!groupedByEmployee[bonus.employeeId]) {
          groupedByEmployee[bonus.employeeId] = [];
        }
        groupedByEmployee[bonus.employeeId].push(enriched);
      });

      return { status: true, data: groupedByEmployee };
    } catch (error) {
      console.error('Error searching bonuses:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to search bonuses',
      };
    }
  }
}
