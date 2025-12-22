import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { CreateOvertimeRequestDto, UpdateOvertimeRequestDto } from './dto/create-overtime-request.dto';

@Injectable()
export class OvertimeRequestService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list(params?: {
    employeeId?: string;
    overtimeType?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }) {
    try {
      const where: any = {};

      if (params?.employeeId) {
        where.employeeId = params.employeeId;
      }

      if (params?.overtimeType) {
        where.overtimeType = params.overtimeType;
      }

      if (params?.status) {
        where.status = params.status;
      }

      if (params?.startDate || params?.endDate) {
        where.date = {};
        if (params?.startDate) {
          where.date.gte = new Date(params.startDate);
        }
        if (params?.endDate) {
          where.date.lte = new Date(params.endDate);
        }
      }

      const overtimeRequests = await this.prisma.overtimeRequest.findMany({
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

      // Transform data to match frontend expectations
      const transformedData = overtimeRequests.map((request) => ({
        id: request.id,
        employeeId: request.employeeId,
        employeeName: request.employee.employeeName,
        employeeCode: request.employee.employeeId,
        overtimeType: request.overtimeType,
        title: request.title,
        description: request.description,
        date: request.date.toISOString(),
        weekdayOvertimeHours: Number(request.weekdayOvertimeHours),
        holidayOvertimeHours: Number(request.holidayOvertimeHours),
        status: request.status,
        approval1: request.approval1,
        approval2: request.approval2,
        createdById: request.createdById,
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
      }));

      return { status: true, data: transformedData };
    } catch (error) {
      console.error('Error listing overtime requests:', error);
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Failed to list overtime requests',
      };
    }
  }

  async get(id: string) {
    try {
      const overtimeRequest = await this.prisma.overtimeRequest.findUnique({
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

      if (!overtimeRequest) {
        return { status: false, message: 'Overtime request not found' };
      }

      // Transform data to match frontend expectations
      const transformedData = {
        id: overtimeRequest.id,
        employeeId: overtimeRequest.employeeId,
        employeeName: overtimeRequest.employee.employeeName,
        employeeCode: overtimeRequest.employee.employeeId,
        overtimeType: overtimeRequest.overtimeType,
        title: overtimeRequest.title,
        description: overtimeRequest.description,
        date: overtimeRequest.date.toISOString(),
        weekdayOvertimeHours: Number(overtimeRequest.weekdayOvertimeHours),
        holidayOvertimeHours: Number(overtimeRequest.holidayOvertimeHours),
        status: overtimeRequest.status,
        approval1: overtimeRequest.approval1,
        approval2: overtimeRequest.approval2,
        createdById: overtimeRequest.createdById,
        createdAt: overtimeRequest.createdAt.toISOString(),
        updatedAt: overtimeRequest.updatedAt.toISOString(),
      };

      return { status: true, data: transformedData };
    } catch (error) {
      console.error('Error getting overtime request:', error);
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Failed to get overtime request',
      };
    }
  }

  async create(body: CreateOvertimeRequestDto, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      // Validate employee exists
      const employee = await this.prisma.employee.findUnique({
        where: { id: body.employeeId },
        select: { id: true },
      });

      if (!employee) {
        return { status: false, message: 'Employee not found' };
      }

      const date = new Date(body.date);

      const overtimeRequest = await this.prisma.overtimeRequest.create({
        data: {
          employeeId: body.employeeId,
          overtimeType: body.overtimeType,
          title: body.title,
          description: body.description ?? null,
          date: date,
          weekdayOvertimeHours: body.weekdayOvertimeHours,
          holidayOvertimeHours: body.holidayOvertimeHours,
          status: 'pending',
          createdById: ctx.userId,
        },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
            },
          },
        },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'overtime-request',
          entity: 'OvertimeRequest',
          entityId: overtimeRequest.id,
          description: `Created overtime request for employee ${overtimeRequest.employee.employeeName}`,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      // Transform data to match frontend expectations
      const transformedData = {
        id: overtimeRequest.id,
        employeeId: overtimeRequest.employeeId,
        employeeName: overtimeRequest.employee.employeeName,
        employeeCode: overtimeRequest.employee.employeeId,
        overtimeType: overtimeRequest.overtimeType,
        title: overtimeRequest.title,
        description: overtimeRequest.description,
        date: overtimeRequest.date.toISOString(),
        weekdayOvertimeHours: Number(overtimeRequest.weekdayOvertimeHours),
        holidayOvertimeHours: Number(overtimeRequest.holidayOvertimeHours),
        status: overtimeRequest.status,
        approval1: overtimeRequest.approval1,
        approval2: overtimeRequest.approval2,
        createdById: overtimeRequest.createdById,
        createdAt: overtimeRequest.createdAt.toISOString(),
        updatedAt: overtimeRequest.updatedAt.toISOString(),
      };

      return {
        status: true,
        data: transformedData,
        message: 'Overtime request created successfully',
      };
    } catch (error) {
      console.error('Error creating overtime request:', error);
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Failed to create overtime request',
      };
    }
  }

  async update(
    id: string,
    body: UpdateOvertimeRequestDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.overtimeRequest.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Overtime request not found' };
      }

      // Validate employee if employeeId is being updated
      if (body.employeeId && body.employeeId !== existing.employeeId) {
        const employee = await this.prisma.employee.findUnique({
          where: { id: body.employeeId },
          select: { id: true },
        });

        if (!employee) {
          return { status: false, message: 'Employee not found' };
        }
      }

      const updateData: any = {};
      if (body.employeeId) updateData.employeeId = body.employeeId;
      if (body.overtimeType) updateData.overtimeType = body.overtimeType;
      if (body.title) updateData.title = body.title;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.date) updateData.date = new Date(body.date);
      if (body.weekdayOvertimeHours !== undefined) updateData.weekdayOvertimeHours = body.weekdayOvertimeHours;
      if (body.holidayOvertimeHours !== undefined) updateData.holidayOvertimeHours = body.holidayOvertimeHours;
      if (body.status) updateData.status = body.status;
      updateData.updatedById = ctx.userId;

      const updated = await this.prisma.overtimeRequest.update({
        where: { id },
        data: updateData,
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
            },
          },
        },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'overtime-request',
          entity: 'OvertimeRequest',
          entityId: id,
          description: 'Updated overtime request',
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      // Transform data to match frontend expectations
      const transformedData = {
        id: updated.id,
        employeeId: updated.employeeId,
        employeeName: updated.employee.employeeName,
        employeeCode: updated.employee.employeeId,
        overtimeType: updated.overtimeType,
        title: updated.title,
        description: updated.description,
        date: updated.date.toISOString(),
        weekdayOvertimeHours: Number(updated.weekdayOvertimeHours),
        holidayOvertimeHours: Number(updated.holidayOvertimeHours),
        status: updated.status,
        approval1: updated.approval1,
        approval2: updated.approval2,
        createdById: updated.createdById,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };

      return { status: true, data: transformedData, message: 'Overtime request updated successfully' };
    } catch (error) {
      console.error('Error updating overtime request:', error);
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Failed to update overtime request',
      };
    }
  }

  async remove(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.overtimeRequest.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Overtime request not found' };
      }

      await this.prisma.overtimeRequest.delete({
        where: { id },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'overtime-request',
          entity: 'OvertimeRequest',
          entityId: id,
          description: 'Deleted overtime request',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return { status: true, message: 'Overtime request deleted successfully' };
    } catch (error) {
      console.error('Error deleting overtime request:', error);
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Failed to delete overtime request',
      };
    }
  }
}

