import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import {
  CreateLeaveEncashmentDto,
  UpdateLeaveEncashmentDto,
  ApproveLeaveEncashmentDto,
} from './dto/leave-encashment.dto';

@Injectable()
export class LeaveEncashmentService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list(params?: {
    employeeId?: string;
    paymentMonth?: string;
    paymentYear?: string;
    paymentMonthYear?: string;
    approvalStatus?: string;
    status?: string;
  }) {
    try {
      const where: any = {};

      if (params?.employeeId) {
        where.employeeId = params.employeeId;
      }

      if (params?.paymentMonth) {
        where.paymentMonth = params.paymentMonth;
      }

      if (params?.paymentYear) {
        where.paymentYear = params.paymentYear;
      }

      if (params?.paymentMonthYear) {
        where.paymentMonthYear = params.paymentMonthYear;
      }

      if (params?.approvalStatus) {
        where.approvalStatus = params.approvalStatus;
      }

      if (params?.status) {
        where.status = params.status;
      }

      const leaveEncashments = await this.prisma.leaveEncashment.findMany({
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

      return { status: true, data: leaveEncashments };
    } catch (error) {
      console.error('Error listing leave encashments:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to list leave encashments',
      };
    }
  }

  async get(id: string) {
    try {
      const leaveEncashment = await this.prisma.leaveEncashment.findUnique({
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

      if (!leaveEncashment) {
        return { status: false, message: 'Leave encashment not found' };
      }

      return { status: true, data: leaveEncashment };
    } catch (error) {
      console.error('Error getting leave encashment:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to get leave encashment',
      };
    }
  }

  async create(
    body: CreateLeaveEncashmentDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!body.leaveEncashments || body.leaveEncashments.length === 0) {
        return {
          status: false,
          message: 'At least one leave encashment item is required',
        };
      }

      // Validate all employees exist
      const employeeIds = body.leaveEncashments.map((l) => l.employeeId);
      const employees = await this.prisma.employee.findMany({
        where: { id: { in: employeeIds } },
        select: { id: true },
      });

      if (employees.length !== employeeIds.length) {
        return { status: false, message: 'One or more employees not found' };
      }

      // Create leave encashments in a transaction
      const result = await this.prisma.$transaction(async (tx) => {
        const createdLeaveEncashments: any[] = [];

        for (const leaveEncashmentItem of body.leaveEncashments) {
          const encashmentDate = new Date(leaveEncashmentItem.encashmentDate);

          const created = await tx.leaveEncashment.create({
            data: {
              employeeId: leaveEncashmentItem.employeeId,
              encashmentDate: encashmentDate,
              encashmentDays: leaveEncashmentItem.encashmentDays,
              encashmentAmount: leaveEncashmentItem.encashmentAmount,
              paymentMonth: leaveEncashmentItem.paymentMonth,
              paymentYear: leaveEncashmentItem.paymentYear,
              paymentMonthYear: leaveEncashmentItem.paymentMonthYear,
              grossSalary: leaveEncashmentItem.grossSalary
                ? leaveEncashmentItem.grossSalary
                : null,
              annualSalary: leaveEncashmentItem.annualSalary
                ? leaveEncashmentItem.annualSalary
                : null,
              perDayAmount: leaveEncashmentItem.perDayAmount
                ? leaveEncashmentItem.perDayAmount
                : null,
              approvalStatus: 'pending',
              status: 'pending',
              createdById: ctx.userId,
            },
          });
          createdLeaveEncashments.push(created);
        }

        return createdLeaveEncashments;
      });

      // Log activity
      if (Array.isArray(result) && result.length > 0 && ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'leave-encashment',
          entity: 'LeaveEncashment',
          entityId: result[0].id,
          description: `Created ${result.length} leave encashment request(s)`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: result,
        message: `Successfully created ${result.length} leave encashment request(s)`,
      };
    } catch (error) {
      console.error('Error creating leave encashment:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to create leave encashment',
      };
    }
  }

  async update(
    id: string,
    body: UpdateLeaveEncashmentDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.leaveEncashment.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Leave encashment not found' };
      }

      const updateData: any = {
        updatedById: ctx.userId,
      };

      if (body.encashmentDate !== undefined) {
        updateData.encashmentDate = new Date(body.encashmentDate);
      }

      if (body.encashmentDays !== undefined) {
        updateData.encashmentDays = body.encashmentDays;
      }

      if (body.encashmentAmount !== undefined) {
        updateData.encashmentAmount = body.encashmentAmount;
      }

      if (body.paymentMonth !== undefined) {
        updateData.paymentMonth = body.paymentMonth;
      }

      if (body.paymentYear !== undefined) {
        updateData.paymentYear = body.paymentYear;
      }

      if (body.paymentMonthYear !== undefined) {
        updateData.paymentMonthYear = body.paymentMonthYear;
      }

      if (body.grossSalary !== undefined) {
        updateData.grossSalary = body.grossSalary;
      }

      if (body.annualSalary !== undefined) {
        updateData.annualSalary = body.annualSalary;
      }

      if (body.perDayAmount !== undefined) {
        updateData.perDayAmount = body.perDayAmount;
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

      const updated = await this.prisma.leaveEncashment.update({
        where: { id },
        data: updateData,
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'leave-encashment',
          entity: 'LeaveEncashment',
          entityId: id,
          description: 'Updated leave encashment request',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: updated,
        message: 'Leave encashment updated successfully',
      };
    } catch (error) {
      console.error('Error updating leave encashment:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to update leave encashment',
      };
    }
  }

  async approve(
    id: string,
    body: ApproveLeaveEncashmentDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.leaveEncashment.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Leave encashment not found' };
      }

      if (existing.approvalStatus !== 'pending') {
        return {
          status: false,
          message: 'Leave encashment is not pending approval',
        };
      }

      const updated = await this.prisma.leaveEncashment.update({
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
          module: 'leave-encashment',
          entity: 'LeaveEncashment',
          entityId: id,
          description: 'Approved leave encashment request',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: updated,
        message: 'Leave encashment approved successfully',
      };
    } catch (error) {
      console.error('Error approving leave encashment:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to approve leave encashment',
      };
    }
  }

  async reject(
    id: string,
    body: ApproveLeaveEncashmentDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.leaveEncashment.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Leave encashment not found' };
      }

      if (existing.approvalStatus !== 'pending') {
        return {
          status: false,
          message: 'Leave encashment is not pending approval',
        };
      }

      const updated = await this.prisma.leaveEncashment.update({
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
          module: 'leave-encashment',
          entity: 'LeaveEncashment',
          entityId: id,
          description: 'Rejected leave encashment request',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: updated,
        message: 'Leave encashment rejected successfully',
      };
    } catch (error) {
      console.error('Error rejecting leave encashment:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to reject leave encashment',
      };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.leaveEncashment.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Leave encashment not found' };
      }

      await this.prisma.leaveEncashment.delete({
        where: { id },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'leave-encashment',
          entity: 'LeaveEncashment',
          entityId: id,
          description: 'Deleted leave encashment request',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return { status: true, message: 'Leave encashment deleted successfully' };
    } catch (error) {
      console.error('Error deleting leave encashment:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to delete leave encashment',
      };
    }
  }
}
