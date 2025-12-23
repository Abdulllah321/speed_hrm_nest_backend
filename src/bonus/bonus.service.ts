import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
    private activityLogs: ActivityLogsService,
  ) {}

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
              department: {
                select: {
                  id: true,
                  name: true,
                },
              },
              subDepartment: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          bonusType: {
            select: {
              id: true,
              name: true,
              calculationType: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return { status: true, data: bonuses };
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
              department: {
                select: {
                  id: true,
                  name: true,
                },
              },
              subDepartment: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          bonusType: {
            select: {
              id: true,
              name: true,
              calculationType: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          updatedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      if (!bonus) {
        return { status: false, message: 'Bonus not found' };
      }

      return { status: true, data: bonus };
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

      // Validate bonus type exists
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
                updatedById: ctx.userId,
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
                status: 'active',
                createdById: ctx.userId,
              },
            });
            createdBonuses.push(created);
          }
        }

        return createdBonuses;
      });

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
        data: result,
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
          ...(body.status && { status: body.status }),
          updatedById: ctx.userId,
        },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
            },
          },
          bonusType: {
            select: {
              id: true,
              name: true,
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

      return {
        status: true,
        data: updated,
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
              department: {
                select: {
                  id: true,
                  name: true,
                },
              },
              subDepartment: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          bonusType: {
            select: {
              id: true,
              name: true,
              calculationType: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Group by employee
      const groupedByEmployee: { [key: string]: any[] } = {};
      bonuses.forEach((bonus) => {
        if (!groupedByEmployee[bonus.employeeId]) {
          groupedByEmployee[bonus.employeeId] = [];
        }
        groupedByEmployee[bonus.employeeId].push(bonus);
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
