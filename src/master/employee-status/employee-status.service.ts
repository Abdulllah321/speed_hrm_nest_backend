import { Injectable } from '@nestjs/common';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';


@Injectable()
export class EmployeeStatusService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list() {
    const items = await this.prisma.employeeStatus.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { status: true, data: items };
  }

  async get(id: string) {
    const item = await this.prisma.employeeStatus.findUnique({
      where: { id },
    });
    if (!item) return { status: false, message: 'Status not found' };
    return { status: true, data: item };
  }

  async create(
    data: { status: string; statusType?: string },
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!data.status) {
        return { status: false, message: 'Status name is required' };
      }
      const item = await this.prisma.employeeStatus.create({
        data: {
          status: data.status,
          statusType: data.statusType || 'Active',
        },
      });
      const response = {
        status: true,
        data: item,
        message: 'Employee status created successfully',
      };
      runInBackground(
        'Create Employee Status',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'employee-statuses',
          entity: 'EmployeeStatus',
          entityId: item.id,
          description: `Created employee status ${item.status}`,
          newValues: JSON.stringify(data),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );
      return response;
    } catch (error) {
      runInBackground(
        'Create Employee Status (Failure Log)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'employee-statuses',
          entity: 'EmployeeStatus',
          description: 'Failed to create employee status',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          newValues: JSON.stringify(data),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to create status',
      };
    }
  }

  async update(
    id: string,
    data: { status?: string; statusType?: string },
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.employeeStatus.findUnique({
        where: { id },
      });
      const item = await this.prisma.employeeStatus.update({
        where: { id },
        data,
      });
      const response = {
        status: true,
        data: item,
        message: 'Employee status updated successfully',
      };
      runInBackground(
        'Update Employee Status',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'employee-statuses',
          entity: 'EmployeeStatus',
          entityId: id,
          description: `Updated employee status ${item.status}`,
          oldValues: JSON.stringify(existing),
          newValues: JSON.stringify(data),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );
      return response;
    } catch (error) {
      runInBackground(
        'Update Employee Status (Failure Log)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'employee-statuses',
          entity: 'EmployeeStatus',
          entityId: id,
          description: 'Failed to update employee status',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          newValues: JSON.stringify(data),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to update status',
      };
    }
  }

  async delete(
    id: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.employeeStatus.findUnique({
        where: { id },
      });
      await this.prisma.employeeStatus.delete({ where: { id } });
      const response = { status: true, message: 'Employee status deleted successfully' };
      runInBackground(
        'Delete Employee Status',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'employee-statuses',
          entity: 'EmployeeStatus',
          entityId: id,
          description: `Deleted employee status ${existing?.status}`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );
      return response;
    } catch (error) {
      runInBackground(
        'Delete Employee Status (Failure Log)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'employee-statuses',
          entity: 'EmployeeStatus',
          entityId: id,
          description: 'Failed to delete employee status',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to delete status',
      };
    }
  }

  async bulkCreate(
    items: { status: string; statusType?: string }[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const validData = items
        .filter((item) => item.status && item.status.trim().length > 0)
        .map((item) => ({
          status: item.status.trim(),
          statusType: item.statusType || 'Active', // Default or verify actual schema requirement
        }));

      if (validData.length === 0) {
        return { status: false, message: 'No valid data provided' };
      }

      const result = await this.prisma.employeeStatus.createMany({
        data: validData,
        skipDuplicates: true,
      });

      const response = {
        status: true,
        message: 'Employee statuses created successfully',
      };
      runInBackground(
        'Bulk Create Employee Statuses',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'employee-statuses',
          entity: 'EmployeeStatus',
          description: `Bulk created employee statuses (${result.count})`,
          newValues: JSON.stringify(items),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );
      return response;
    } catch (error) {
      let errorMessage = 'Failed to create employee statuses';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      runInBackground(
        'Bulk Create Employee Statuses (Failure Log)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'employee-statuses',
          entity: 'EmployeeStatus',
          description: 'Failed bulk create employee statuses',
          errorMessage: errorMessage,
          newValues: JSON.stringify(items),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: errorMessage };
    }
  }
}
