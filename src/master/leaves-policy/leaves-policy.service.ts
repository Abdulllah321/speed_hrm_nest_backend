import { Injectable } from '@nestjs/common';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { PrismaService } from '../../database/prisma.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
import { MasterDeleteGuardService } from '../../common/services/master-delete-guard.service';


@Injectable()
export class LeavesPolicyService {
  constructor(
    private readonly masterDeleteGuard: MasterDeleteGuardService,
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list() {
    const items = await this.prisma.leavesPolicy.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        leaveTypes: {
          where: { isDeleted: false },
          include: {
            leaveType: true,
          },
        },
      },
        where: { isDeleted: false }
    });
    // Transform the data to include leaveTypeName
    const transformedItems = items.map((item) => ({
      ...item,
      leaveTypes: item.leaveTypes.map((lt) => ({
        leaveTypeId: lt.leaveTypeId,
        leaveTypeName: lt.leaveType.name,
        numberOfLeaves: lt.numberOfLeaves,
      })),
    }));
    return { status: true, data: transformedItems };
  }

  async get(id: string) {
    const item = await this.prisma.leavesPolicy.findFirst({
      where: { id,
          isDeleted: false
    },
      include: {
        leaveTypes: {
          where: { isDeleted: false },
          include: {
            leaveType: true,
          },
        },
      },
    });
    if (!item) return { status: false, message: 'Leaves policy not found' };
    // Transform the data to include leaveTypeName
    const transformedItem = {
      ...item,
      leaveTypes: item.leaveTypes.map((lt) => ({
        leaveTypeId: lt.leaveTypeId,
        leaveTypeName: lt.leaveType.name,
        numberOfLeaves: lt.numberOfLeaves,
      })),
    };
    return { status: true, data: transformedItem };
  }

  async create(
    body: {
      name: string;
      details?: string;
      policyDateFrom?: string;
      policyDateTill?: string;
      fullDayDeductionRate?: number;
      halfDayDeductionRate?: number;
      shortLeaveDeductionRate?: number;
      status?: string;
      isDefault?: boolean;
      leaveTypes?: { leaveTypeId: string; numberOfLeaves: number }[];
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      // If setting as default, unset all other policies first
      if (body.isDefault) {
        await this.prisma.leavesPolicy.updateMany({
          where: { isDefault: true, isDeleted: false },
          data: { isDefault: false },
        });
      }

      const created = await this.prisma.leavesPolicy.create({
        data: {
          name: body.name,
          details: body.details ?? null,
          policyDateFrom: body.policyDateFrom
            ? (new Date(body.policyDateFrom) as any)
            : null,
          policyDateTill: body.policyDateTill
            ? (new Date(body.policyDateTill) as any)
            : null,
          fullDayDeductionRate: body.fullDayDeductionRate as any,
          halfDayDeductionRate: body.halfDayDeductionRate as any,
          shortLeaveDeductionRate: body.shortLeaveDeductionRate as any,
          status: body.status ?? 'active',
          isDefault: body.isDefault ?? false,
          createdById: ctx.userId,
        },
      });

      if (body.leaveTypes?.length) {
        await this.prisma.leavesPolicyLeaveType.createMany({
          data: body.leaveTypes.map((lt) => ({
            leavesPolicyId: created.id,
            leaveTypeId: lt.leaveTypeId,
            numberOfLeaves: lt.numberOfLeaves,
          })),
          skipDuplicates: true,
        });
      }

      // Fetch the created record with leaveTypes included
      const createdWithLeaveTypes = await this.prisma.leavesPolicy.findFirst({
        where: { id: created.id,
            isDeleted: false
        },
        include: {
          leaveTypes: {
            where: { isDeleted: false },
            include: {
              leaveType: true,
            },
          },
        },
      });

      runInBackground(
        'Create Record',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'leaves-policies',
          entity: 'LeavesPolicy',
          entityId: created.id,
          description: `Created leaves policy ${created.name}`,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );

      // Transform the data to include leaveTypeName
      const transformedItem = createdWithLeaveTypes
        ? {
            ...createdWithLeaveTypes,
            leaveTypes: createdWithLeaveTypes.leaveTypes.map((lt) => ({
              leaveTypeId: lt.leaveTypeId,
              leaveTypeName: lt.leaveType.name,
              numberOfLeaves: lt.numberOfLeaves,
            })),
          }
        : created;

      return {
        status: true,
        data: transformedItem,
        message: 'Leaves policy created successfully',
      };
    } catch (error: any) {
      runInBackground(
        'Failed to create leaves policy (Failure Log)',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'leaves-policies',
          entity: 'LeavesPolicy',
          description: 'Failed to create leaves policy',
          errorMessage: error?.message,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: 'Failed to create leaves policy' };
    }
  }

  async createBulk(
    items: { name: string; details?: string; status?: string }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length) return { status: false, message: 'No items to create' };
    try {
      const res = await this.prisma.leavesPolicy.createMany({
        data: items.map((i) => ({
          name: i.name,
          details: i.details ?? null,
          status: i.status ?? 'active',
          createdById: ctx.userId,
        })),
        skipDuplicates: true,
      });

      runInBackground(
        'Bulk Create Records',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'leaves-policies',
          entity: 'LeavesPolicy',
          description: `Bulk created ${res.count} leaves policies`,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );

      return {
        status: true,
        data: res,
        message: 'Leaves policies created successfully',
      };
    } catch (error: any) {
      runInBackground(
        'Failed bulk create leaves policies',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'leaves-policies',
          entity: 'LeavesPolicy',
          description: 'Failed bulk create leaves policies',
          errorMessage: error?.message,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: 'Failed to create leaves policies' };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const deleteBlocked = await this.masterDeleteGuard.checkBlocked(this.prisma, 'leavesPolicy', id);
      if (deleteBlocked) return { status: false, message: deleteBlocked };

      const existing = await this.prisma.leavesPolicy.findFirst({
        where: { id,
            isDeleted: false
        },
      });
      if (!existing)
        return { status: false, message: 'Leaves policy not found' };

      await this.prisma.leavesPolicy.update({ where: { id },
          data: { isDeleted: true, deletedAt: new Date() }
    });

      runInBackground(
        'Delete Record',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'leaves-policies',
          entity: 'LeavesPolicy',
          entityId: id,
          description: `Deleted leaves policy ${existing.name}`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );

      return {
        status: true,
        data: existing,
        message: 'Leaves policy deleted successfully',
      };
    } catch (error: any) {
      runInBackground(
        'Failed to delete leaves policy',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'leaves-policies',
          entity: 'LeavesPolicy',
          entityId: id,
          description: 'Failed to delete leaves policy',
          errorMessage: error?.message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: 'Failed to delete leaves policy' };
    }
  }

  async update(
    id: string,
    body: {
      name?: string;
      details?: string;
      policyDateFrom?: string;
      policyDateTill?: string;
      fullDayDeductionRate?: number;
      halfDayDeductionRate?: number;
      shortLeaveDeductionRate?: number;
      status?: string;
      isDefault?: boolean;
      leaveTypes?: { leaveTypeId: string; numberOfLeaves: number }[];
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.leavesPolicy.findFirst({
        where: { id,
            isDeleted: false
        },
        include: { leaveTypes: true },
      });
      if (!existing)
        return { status: false, message: 'Leaves policy not found' };

      // If setting as default, unset all other policies first
      if (body.isDefault === true && !existing.isDefault) {
        await this.prisma.leavesPolicy.updateMany({
          where: { isDefault: true, isDeleted: false },
          data: { isDefault: false },
        });
      }

      const updated = await this.prisma.leavesPolicy.update({
        where: { id },
        data: {
          name: body.name ?? existing.name,
          details: body.details ?? existing.details,
          policyDateFrom: body.policyDateFrom
            ? (new Date(body.policyDateFrom) as any)
            : existing.policyDateFrom,
          policyDateTill: body.policyDateTill
            ? (new Date(body.policyDateTill) as any)
            : existing.policyDateTill,
          fullDayDeductionRate: (body.fullDayDeductionRate ??
            (existing as any).fullDayDeductionRate) as any,
          halfDayDeductionRate: (body.halfDayDeductionRate ??
            (existing as any).halfDayDeductionRate) as any,
          shortLeaveDeductionRate: (body.shortLeaveDeductionRate ??
            (existing as any).shortLeaveDeductionRate) as any,
          status: body.status ?? existing.status,
          isDefault:
            body.isDefault !== undefined ? body.isDefault : existing.isDefault,
        },
      });

      if (body.leaveTypes) {
        await this.prisma.leavesPolicyLeaveType.updateMany({
          where: { leavesPolicyId: id },
            data: { isDeleted: true, deletedAt: new Date() }
        });
        if (body.leaveTypes.length) {
          await this.prisma.leavesPolicyLeaveType.createMany({
            data: body.leaveTypes.map((lt) => ({
              leavesPolicyId: id,
              leaveTypeId: lt.leaveTypeId,
              numberOfLeaves: lt.numberOfLeaves,
            })),
            skipDuplicates: true,
          });
        }
      }

      // Fetch the updated record with leaveTypes included
      const updatedWithLeaveTypes = await this.prisma.leavesPolicy.findFirst({
        where: { id,
            isDeleted: false
        },
        include: {
          leaveTypes: {
            where: { isDeleted: false },
            include: {
              leaveType: true,
            },
          },
        },
      });

      runInBackground(
        'Update Record',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'leaves-policies',
          entity: 'LeavesPolicy',
          entityId: id,
          description: `Updated leaves policy ${updated.name}`,
          oldValues: JSON.stringify(existing),
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );

      // Transform the data to include leaveTypeName
      const transformedItem = updatedWithLeaveTypes
        ? {
            ...updatedWithLeaveTypes,
            leaveTypes: updatedWithLeaveTypes.leaveTypes.map((lt) => ({
              leaveTypeId: lt.leaveTypeId,
              leaveTypeName: lt.leaveType.name,
              numberOfLeaves: lt.numberOfLeaves,
            })),
          }
        : updated;

      return {
        status: true,
        data: transformedItem,
        message: 'Leaves policy updated successfully',
      };
    } catch (error: any) {
      runInBackground(
        'Failed to update leaves policy (Failure Log)',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'leaves-policies',
          entity: 'LeavesPolicy',
          entityId: id,
          description: 'Failed to update leaves policy',
          errorMessage: error?.message,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: 'Failed to update leaves policy' };
    }
  }

  async removeBulk(
    ids: string[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!ids?.length) return { status: false, message: 'No items to delete' };
    try {
      for (const guardId of ids) {
        const deleteBlocked = await this.masterDeleteGuard.checkBlocked(this.prisma, 'leavesPolicy', guardId);
        if (deleteBlocked) return { status: false, message: deleteBlocked };
      }

      await this.prisma.leavesPolicy.updateMany({
        where: { id: { in: ids } },
          data: { isDeleted: true, deletedAt: new Date() }
    });

      runInBackground(
        'Bulk Delete Records',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'leaves-policies',
          entity: 'LeavesPolicy',
          description: `Bulk deleted ${ids.length} leaves policies`,
          oldValues: JSON.stringify(ids),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );

      return { status: true, message: 'Leaves policies deleted successfully' };
    } catch (error: any) {
      runInBackground(
        'Failed bulk delete leaves policies',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'leaves-policies',
          entity: 'LeavesPolicy',
          description: 'Failed bulk delete leaves policies',
          errorMessage: error?.message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: 'Failed to delete leaves policies' };
    }
  }

  async updateBulk(
    items: { id: string; name: string; details?: string; status?: string }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length) return { status: false, message: 'No items to update' };
    try {
      for (const i of items) {
        await this.prisma.leavesPolicy.update({
          where: { id: i.id },
          data: {
            name: i.name,
            details: i.details ?? null,
            status: i.status ?? 'active',
          },
        });
      }

      runInBackground(
        'Bulk Update Records',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'leaves-policies',
          entity: 'LeavesPolicy',
          description: `Bulk updated ${items.length} leaves policies`,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );

      return { status: true, message: 'Bulk update completed successfully' };
    } catch (error: any) {
      runInBackground(
        'Failed bulk update leaves policies',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'leaves-policies',
          entity: 'LeavesPolicy',
          description: 'Failed bulk update leaves policies',
          errorMessage: error?.message,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: 'Failed to update leaves policies' };
    }
  }

  async setAsDefault(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.leavesPolicy.findFirst({
        where: { id,
            isDeleted: false
        },
      });
      if (!existing) {
        return { status: false, message: 'Leaves policy not found' };
      }

      // Unset all other policies as default
      await this.prisma.leavesPolicy.updateMany({
        where: { isDefault: true, isDeleted: false },
        data: { isDefault: false },
      });

      // Set this policy as default
      const updated = await this.prisma.leavesPolicy.update({
        where: { id },
        data: { isDefault: true },
      });

      runInBackground(
        `Set leaves policy ${updated.name} as default`,
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'leaves-policies',
          entity: 'LeavesPolicy',
          entityId: id,
          description: `Set leaves policy ${updated.name} as default`,
          oldValues: JSON.stringify({ isDefault: existing.isDefault }),
          newValues: JSON.stringify({ isDefault: true }),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );

      return { status: true, data: updated, message: 'Leaves policy set as default successfully' };
    } catch (error: any) {
      runInBackground(
        'Failed to set leaves policy as default (Failure Log)',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'leaves-policies',
          entity: 'LeavesPolicy',
          entityId: id,
          description: 'Failed to set leaves policy as default',
          errorMessage: error?.message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return {
        status: false,
        message: error?.message || 'Failed to set leaves policy as default',
      };
    }
  }
}
