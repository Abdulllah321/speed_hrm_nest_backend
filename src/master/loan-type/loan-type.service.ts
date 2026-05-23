import { Injectable } from '@nestjs/common';
import { BulkUpdateLoanTypeItemDto } from './dto/loan-type.dto';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
import { MasterDeleteGuardService } from '../../common/services/master-delete-guard.service';

@Injectable()
export class LoanTypeService {
  constructor(
    private readonly masterDeleteGuard: MasterDeleteGuardService,
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list() {
    const items = await this.prisma.loanType.findMany({
      orderBy: { createdAt: 'desc' },
        where: { isDeleted: false }
    });
    return { status: true, data: items };
  }

  async get(id: string) {
    const item = await this.prisma.loanType.findFirst({ where: { id,
        isDeleted: false
    } });
    if (!item) return { status: false, message: 'Loan type not found' };
    return { status: true, data: item };
  }

  async create(
    body: { name: string; status?: string },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const created = await this.prisma.loanType.create({
        data: {
          name: body.name,
          status: body.status ?? 'active',
          createdById: ctx.userId,
        },
      });

      runInBackground(
        `Created loan type ${created.name}`,
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'loan-types',
          entity: 'LoanType',
          entityId: created.id,
          description: `Created loan type ${created.name}`,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );

      return {
        status: true,
        data: created,
        message: 'Loan type created successfully',
      };
    } catch (error: any) {
      runInBackground(
        'Failed to create loan type',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'loan-types',
          entity: 'LoanType',
          description: 'Failed to create loan type',
          errorMessage: error?.message,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: 'Failed to create loan type' };
    }
  }

  async update(
    id: string,
    body: { name: string; status?: string },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.loanType.findFirst({
        where: { id,
            isDeleted: false
        },
      });
      if (!existing) return { status: false, message: 'Loan type not found' };

      const updated = await this.prisma.loanType.update({
        where: { id },
        data: {
          name: body.name ?? existing.name,
          status: body.status ?? existing.status,
        },
      });

      runInBackground(
        `Updated loan type ${updated.name}`,
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'loan-types',
          entity: 'LoanType',
          entityId: id,
          description: `Updated loan type ${updated.name}`,
          oldValues: JSON.stringify(existing),
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );

      return {
        status: true,
        data: updated,
        message: 'Loan type updated successfully',
      };
    } catch (error: any) {
      runInBackground(
        'Failed to update loan type',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'loan-types',
          entity: 'LoanType',
          entityId: id,
          description: 'Failed to update loan type',
          errorMessage: error?.message,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: 'Failed to update loan type' };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const deleteBlocked = await this.masterDeleteGuard.checkBlocked(this.prisma, 'loanType', id);
      if (deleteBlocked) return { status: false, message: deleteBlocked };

      const existing = await this.prisma.loanType.findFirst({
        where: { id,
            isDeleted: false
        },
      });
      if (!existing) return { status: false, message: 'Loan type not found' };

      const removed = await this.prisma.loanType.update({
        where: { id },
          data: { isDeleted: true, deletedAt: new Date() }
    });

      runInBackground(
        `Deleted loan type ${existing.name}`,
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'loan-types',
          entity: 'LoanType',
          entityId: id,
          description: `Deleted loan type ${existing.name}`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );

      return { status: true, data: removed, message: 'Loan type deleted successfully' };
    } catch (error: any) {
      runInBackground(
        'Failed to delete loan type',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'loan-types',
          entity: 'LoanType',
          entityId: id,
          description: 'Failed to delete loan type',
          errorMessage: error?.message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: 'Failed to delete loan type' };
    }
  }

  async createBulk(
    items: { name: string; status?: string }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length)
      return { status: false, message: 'No loan types to create' };
    try {
      const result = await this.prisma.loanType.createMany({
        data: items.map((i) => ({
          name: i.name,
          status: i.status ?? 'active',
          createdById: ctx.userId,
        })),
        skipDuplicates: true,
      });

      runInBackground(
        `Bulk created loan types (${result.count})`,
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'loan-types',
          entity: 'LoanType',
          description: `Bulk created loan types (${result.count})`,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );

      return { status: true, data: result, message: 'Loan types created successfully' };
    } catch (error: any) {
      runInBackground(
        'Failed to bulk create loan types',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'loan-types',
          entity: 'LoanType',
          description: 'Failed to bulk create loan types',
          errorMessage: error?.message,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: 'Failed to create loan types' };
    }
  }

  async updateBulk(
    items: BulkUpdateLoanTypeItemDto[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    const validItems = (items || []).filter(
      (item) => item.id && item.id.trim().length > 0,
    );
    if (validItems.length === 0) {
      return { status: false, message: 'No valid loan type IDs provided' };
    }

    try {
      const updatedItems: any[] = [];
      for (const i of validItems) {
        const existing = await this.prisma.loanType.findFirst({
          where: { id: i.id,
              isDeleted: false
        },
        });
        if (!existing) continue;

        const updated = await this.prisma.loanType.update({
          where: { id: i.id },
          data: {
            name: i.name ?? existing.name,
            status: i.status ?? existing.status,
          },
        });
        updatedItems.push(updated);
      }

      runInBackground(
        `Bulk updated loan types (${updatedItems.length})`,
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'loan-types',
          entity: 'LoanType',
          description: `Bulk updated loan types (${updatedItems.length})`,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );

      return { status: true, data: updatedItems, message: 'Loan types updated successfully' };
    } catch (error: any) {
      runInBackground(
        'Failed to bulk update loan types',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'loan-types',
          entity: 'LoanType',
          description: 'Failed to bulk update loan types',
          errorMessage: error?.message,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: 'Failed to update loan types' };
    }
  }

  async removeBulk(
    ids: string[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!ids?.length)
      return { status: false, message: 'No loan types to delete' };
    try {
      for (const guardId of ids) {
        const deleteBlocked = await this.masterDeleteGuard.checkBlocked(this.prisma, 'loanType', guardId);
        if (deleteBlocked) return { status: false, message: deleteBlocked };
      }

      const existing = await this.prisma.loanType.findMany({
        where: { id: { in: ids },
            isDeleted: false
        },
      });
      const result = await this.prisma.loanType.updateMany({
        where: { id: { in: ids } },
          data: { isDeleted: true, deletedAt: new Date() }
    });

      runInBackground(
        `Bulk deleted loan types (${result.count})`,
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'loan-types',
          entity: 'LoanType',
          description: `Bulk deleted loan types (${result.count})`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );

      return { status: true, message: 'Loan types deleted successfully' };
    } catch (error: any) {
      runInBackground(
        'Failed to bulk delete loan types',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'loan-types',
          entity: 'LoanType',
          description: 'Failed to bulk delete loan types',
          errorMessage: error?.message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: 'Failed to delete loan types' };
    }
  }
}
