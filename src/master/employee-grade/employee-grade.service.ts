import { Injectable } from '@nestjs/common';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
import { MasterDeleteGuardService } from '../../common/services/master-delete-guard.service';


@Injectable()
export class EmployeeGradeService {
  constructor(
    private readonly masterDeleteGuard: MasterDeleteGuardService,
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list() {
    const items = await this.prisma.employeeGrade.findMany({
      orderBy: { createdAt: 'desc' },
        where: { isDeleted: false }
    });
    return { status: true, data: items };
  }

  async get(id: string) {
    const item = await this.prisma.employeeGrade.findFirst({
      where: { id,
          isDeleted: false
    },
    });
    if (!item) return { status: false, message: 'Grade not found' };
    return { status: true, data: item };
  }

  async create(
    data: { grade: string; status?: string },
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!data.grade) {
        return { status: false, message: 'Grade name is required' };
      }
      const item = await this.prisma.employeeGrade.create({
        data: {
          grade: data.grade,
          status: data.status || 'Active',
        },
      });
      const response = {
        status: true,
        data: item,
        message: 'Employee grade created successfully',
      };
      runInBackground(
        'Create Employee Grade',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'employee-grades',
          entity: 'EmployeeGrade',
          entityId: item.id,
          description: `Created employee grade ${item.grade}`,
          newValues: JSON.stringify(data),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );
      return response;
    } catch (error) {
      runInBackground(
        'Create Employee Grade (Failure Log)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'employee-grades',
          entity: 'EmployeeGrade',
          description: 'Failed to create employee grade',
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
          error instanceof Error ? error.message : 'Failed to create grade',
      };
    }
  }

  async update(
    id: string,
    data: { grade?: string; status?: string },
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.employeeGrade.findFirst({
        where: { id,
            isDeleted: false
        },
      });
      const item = await this.prisma.employeeGrade.update({
        where: { id },
        data,
      });
      const response = {
        status: true,
        data: item,
        message: 'Employee grade updated successfully',
      };
      runInBackground(
        'Update Employee Grade',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'employee-grades',
          entity: 'EmployeeGrade',
          entityId: id,
          description: `Updated employee grade ${item.grade}`,
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
        'Update Employee Grade (Failure Log)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'employee-grades',
          entity: 'EmployeeGrade',
          entityId: id,
          description: 'Failed to update employee grade',
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
          error instanceof Error ? error.message : 'Failed to update grade',
      };
    }
  }

  async delete(
    id: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const deleteBlocked = await this.masterDeleteGuard.checkBlocked(this.prisma, 'employeeGrade', id);
      if (deleteBlocked) return { status: false, message: deleteBlocked };

      const existing = await this.prisma.employeeGrade.findFirst({
        where: { id,
            isDeleted: false
        },
      });
      await this.prisma.employeeGrade.update({ where: { id },
          data: { isDeleted: true, deletedAt: new Date() }
    });
      const response = { status: true, message: 'Employee grade deleted successfully' };
      runInBackground(
        'Delete Employee Grade',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'employee-grades',
          entity: 'EmployeeGrade',
          entityId: id,
          description: `Deleted employee grade ${existing?.grade}`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );
      return response;
    } catch (error) {
      runInBackground(
        'Delete Employee Grade (Failure Log)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'employee-grades',
          entity: 'EmployeeGrade',
          entityId: id,
          description: 'Failed to delete employee grade',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to delete grade',
      };
    }
  }

  async bulkCreate(
    items: { grade: string; status?: string }[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const validData = items
        .filter((item) => item.grade && item.grade.trim().length > 0)
        .map((item) => ({
          grade: item.grade.trim(),
          status: item.status || 'Active',
        }));

      if (validData.length === 0) {
        return { status: false, message: 'No valid data provided' };
      }

      const result = await this.prisma.employeeGrade.createMany({
        data: validData,
        skipDuplicates: true,
      });

      const response = { status: true, message: 'Employee grades created successfully' };
      runInBackground(
        'Bulk Create Employee Grades',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'employee-grades',
          entity: 'EmployeeGrade',
          description: `Bulk created employee grades (${result.count})`,
          newValues: JSON.stringify(items),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );
      return response;
    } catch (error) {
      let errorMessage = 'Failed to create employee grades';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      runInBackground(
        'Bulk Create Employee Grades (Failure Log)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'employee-grades',
          entity: 'EmployeeGrade',
          description: 'Failed bulk create employee grades',
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
