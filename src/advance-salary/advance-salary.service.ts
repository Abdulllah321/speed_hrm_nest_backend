import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import {
  CreateAdvanceSalaryDto,
  UpdateAdvanceSalaryDto,
  ApproveAdvanceSalaryDto,
} from './dto/create-advance-salary.dto';

@Injectable()
export class AdvanceSalaryService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list(params?: {
    employeeId?: string;
    deductionMonth?: string;
    deductionYear?: string;
    deductionMonthYear?: string;
    approvalStatus?: string;
    status?: string;
  }) {
    try {
      const where: any = {};

      if (params?.employeeId) {
        where.employeeId = params.employeeId;
      }

      if (params?.deductionMonth) {
        where.deductionMonth = params.deductionMonth;
      }

      if (params?.deductionYear) {
        where.deductionYear = params.deductionYear;
      }

      if (params?.deductionMonthYear) {
        where.deductionMonthYear = params.deductionMonthYear;
      }

      if (params?.approvalStatus) {
        where.approvalStatus = params.approvalStatus;
      }

      if (params?.status) {
        where.status = params.status;
      }

      const advanceSalaries = await this.prisma.advanceSalary.findMany({
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
          approvedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
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
        orderBy: {
          createdAt: 'desc',
        },
      });

      return { status: true, data: advanceSalaries };
    } catch (error) {
      console.error('Error listing advance salaries:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to list advance salaries',
      };
    }
  }

  async get(id: string) {
    try {
      const advanceSalary = await this.prisma.advanceSalary.findUnique({
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
          approvedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
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

      if (!advanceSalary) {
        return { status: false, message: 'Advance salary not found' };
      }

      return { status: true, data: advanceSalary };
    } catch (error) {
      console.error('Error getting advance salary:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to get advance salary',
      };
    }
  }

  async create(
    body: CreateAdvanceSalaryDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!body.advanceSalaries || body.advanceSalaries.length === 0) {
        return {
          status: false,
          message: 'At least one advance salary item is required',
        };
      }

      // Validate all employees exist
      const employeeIds = body.advanceSalaries.map((a) => a.employeeId);
      const employees = await this.prisma.employee.findMany({
        where: { id: { in: employeeIds } },
        select: { id: true },
      });

      if (employees.length !== employeeIds.length) {
        return { status: false, message: 'One or more employees not found' };
      }

      // Create advance salaries in a transaction
      const result = await this.prisma.$transaction(async (tx) => {
        const createdAdvanceSalaries: any[] = [];

        for (const advanceSalaryItem of body.advanceSalaries) {
          const neededOnDate = new Date(advanceSalaryItem.neededOn);

          const created = await tx.advanceSalary.create({
            data: {
              employeeId: advanceSalaryItem.employeeId,
              amount: advanceSalaryItem.amount,
              neededOn: neededOnDate,
              deductionMonth: advanceSalaryItem.deductionMonth,
              deductionYear: advanceSalaryItem.deductionYear,
              deductionMonthYear: advanceSalaryItem.deductionMonthYear,
              reason: advanceSalaryItem.reason,
              approvalStatus: 'pending',
              status: 'pending',
              createdById: ctx.userId,
            },
          });
          createdAdvanceSalaries.push(created);
        }

        // Provide a typed return instead of `any[]`
        return createdAdvanceSalaries as {
          id: string;
          employeeId: string;
          amount: number;
          neededOn: Date;
          deductionMonth: number | null;
          deductionYear: number | null;
          deductionMonthYear: string | null;
          reason: string | null;
          approvalStatus: string;
          status: string;
          createdById: string | null;
        }[];
      });

      // Log activity
      if (Array.isArray(result) && result.length > 0 && ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'advance-salary',
          entity: 'AdvanceSalary',
          entityId: result[0].id,
          description: `Created ${result.length} advance salary request(s)`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: result,
        message: `Successfully created ${result.length} advance salary request(s)`,
      };
    } catch (error) {
      console.error('Error creating advance salary:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to create advance salary',
      };
    }
  }

  async update(
    id: string,
    body: UpdateAdvanceSalaryDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.advanceSalary.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Advance salary not found' };
      }

      const updateData: any = {
        updatedById: ctx.userId,
      };

      if (body.amount !== undefined) {
        updateData.amount = body.amount;
      }

      if (body.neededOn !== undefined) {
        updateData.neededOn = new Date(body.neededOn);
      }

      if (body.deductionMonth !== undefined) {
        updateData.deductionMonth = body.deductionMonth;
      }

      if (body.deductionYear !== undefined) {
        updateData.deductionYear = body.deductionYear;
      }

      if (body.deductionMonthYear !== undefined) {
        updateData.deductionMonthYear = body.deductionMonthYear;
      }

      if (body.reason !== undefined) {
        updateData.reason = body.reason;
      }

      if (body.approvalStatus !== undefined) {
        updateData.approvalStatus = body.approvalStatus;
      }

      if (body.rejectionReason !== undefined) {
        updateData.rejectionReason = body.rejectionReason;
      }

      if (body.status !== undefined) {
        updateData.status = body.status;
      }

      const updated = await this.prisma.advanceSalary.update({
        where: { id },
        data: updateData,
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'advance-salary',
          entity: 'AdvanceSalary',
          entityId: id,
          description: 'Updated advance salary request',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: updated,
        message: 'Advance salary updated successfully',
      };
    } catch (error) {
      console.error('Error updating advance salary:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to update advance salary',
      };
    }
  }

  async approve(
    id: string,
    body: ApproveAdvanceSalaryDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.advanceSalary.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Advance salary not found' };
      }

      if (existing.approvalStatus !== 'pending') {
        return {
          status: false,
          message: 'Advance salary is not pending approval',
        };
      }

      const updated = await this.prisma.advanceSalary.update({
        where: { id },
        data: {
          approvalStatus: 'approved',
          status: 'active',
          approvedById: ctx.userId,
          approvedAt: new Date(),
          updatedById: ctx.userId,
        },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'approve',
          module: 'advance-salary',
          entity: 'AdvanceSalary',
          entityId: id,
          description: 'Approved advance salary request',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: updated,
        message: 'Advance salary approved successfully',
      };
    } catch (error) {
      console.error('Error approving advance salary:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to approve advance salary',
      };
    }
  }

  async reject(
    id: string,
    body: ApproveAdvanceSalaryDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.advanceSalary.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Advance salary not found' };
      }

      if (existing.approvalStatus !== 'pending') {
        return {
          status: false,
          message: 'Advance salary is not pending approval',
        };
      }

      const updated = await this.prisma.advanceSalary.update({
        where: { id },
        data: {
          approvalStatus: 'rejected',
          status: 'rejected',
          rejectionReason: body.rejectionReason || null,
          approvedById: ctx.userId,
          approvedAt: new Date(),
          updatedById: ctx.userId,
        },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'reject',
          module: 'advance-salary',
          entity: 'AdvanceSalary',
          entityId: id,
          description: 'Rejected advance salary request',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: updated,
        message: 'Advance salary rejected successfully',
      };
    } catch (error) {
      console.error('Error rejecting advance salary:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to reject advance salary',
      };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.advanceSalary.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Advance salary not found' };
      }

      await this.prisma.advanceSalary.delete({
        where: { id },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'advance-salary',
          entity: 'AdvanceSalary',
          entityId: id,
          description: 'Deleted advance salary request',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return { status: true, message: 'Advance salary deleted successfully' };
    } catch (error) {
      console.error('Error deleting advance salary:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to delete advance salary',
      };
    }
  }
}
