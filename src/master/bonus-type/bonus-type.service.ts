import { Injectable } from '@nestjs/common';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { PrismaService } from '../../database/prisma.service';

import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
import { MasterDeleteGuardService } from '../../common/services/master-delete-guard.service';

@Injectable()
export class BonusTypeService {
  constructor(
    private readonly masterDeleteGuard: MasterDeleteGuardService,
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list() {
    const items = await this.prisma.bonusType.findMany({
      orderBy: { createdAt: 'desc' },
        where: { isDeleted: false }
    });
    return { status: true, data: items };
  }

  async get(id: string) {
    const item = await this.prisma.bonusType.findFirst({
      where: { id,
          isDeleted: false
    },
    });
    if (!item) return { status: false, message: 'Bonus type not found' };
    return { status: true, data: item };
  }

  async create(
    body: {
      name: string;
      calculationType?: string;
      amount?: number;
      percentage?: number;
      status?: string;
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const created = await this.prisma.bonusType.create({
        data: {
          name: body.name,
          calculationType: body.calculationType ?? 'Amount',
          amount: body.amount ? Number(body.amount) : null,
          percentage: body.percentage ? Number(body.percentage) : null,
          status: body.status ?? 'active',
          createdById: ctx.userId,
        },
      });
      
      const response = { status: true, data: created };
      runInBackground(
        'Create Record',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'create',
        module: 'bonus-types',
        entity: 'BonusType',
        entityId: created.id,
        description: `Created bonus type ${created.name}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      }),
      );
      return response;
    } catch (error: any) {
      
      runInBackground(
        'Failed to create bonus type',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'create',
        module: 'bonus-types',
        entity: 'BonusType',
        description: 'Failed to create bonus type',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
        }),
      );
      return { status: false, message: 'Failed to create bonus type' };
    }
  }

  async createBulk(
    items: {
      name: string;
      calculationType?: string;
      amount?: number;
      percentage?: number;
      status?: string;
    }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length) return { status: false, message: 'No items to create' };
    try {
      const res = await this.prisma.bonusType.createMany({
        data: items.map((i) => ({
          name: i.name,
          calculationType: i.calculationType ?? 'Amount',
          amount: i.amount ? Number(i.amount) : null,
          percentage: i.percentage ? Number(i.percentage) : null,
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
        module: 'bonus-types',
        entity: 'BonusType',
        description: `Bulk created ${res.count} bonus types`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      }),
      );
      return { status: true, message: 'Bonus types created successfully' };
    } catch (error: any) {
      
      runInBackground(
        'Failed bulk create bonus types',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'create',
        module: 'bonus-types',
        entity: 'BonusType',
        description: 'Failed bulk create bonus types',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      }),
      );
      return { status: false, message: 'Failed to create bonus types' };
    }
  }

  async update(
    id: string,
    body: {
      name?: string;
      calculationType?: string;
      amount?: number;
      percentage?: number;
      status?: string;
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.bonusType.findFirst({
        where: { id,
            isDeleted: false
        },
      });
      if (!existing) return { status: false, message: 'Bonus type not found' };
      const updated = await this.prisma.bonusType.update({
        where: { id },
        data: {
          name: body.name ?? existing.name,
          calculationType: body.calculationType ?? existing.calculationType,
          amount:
            body.amount !== undefined
              ? body.amount
                ? Number(body.amount)
                : null
              : existing.amount,
          percentage:
            body.percentage !== undefined
              ? body.percentage
                ? Number(body.percentage)
                : null
              : existing.percentage,
          status: body.status ?? existing.status,
        },
      });
      const response = { status: true, data: updated };
      runInBackground(
        'Update Record',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'update',
        module: 'bonus-types',
        entity: 'BonusType',
        entityId: id,
        description: `Updated bonus type ${updated.name}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      }),
      );
      return response;
    } catch (error: any) {
      
      runInBackground(
        'Failed to update bonus type',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'update',
        module: 'bonus-types',
        entity: 'BonusType',
        entityId: id,
        description: 'Failed to update bonus type',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      }),
      );
      return { status: false, message: 'Failed to update bonus type' };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const deleteBlocked = await this.masterDeleteGuard.checkBlocked(this.prisma, 'bonusType', id);
      if (deleteBlocked) return { status: false, message: deleteBlocked };

      const existing = await this.prisma.bonusType.findFirst({
        where: { id,
            isDeleted: false
        },
      });
      if (!existing) return { status: false, message: 'Bonus type not found' };
      await this.prisma.bonusType.update({ where: { id },
          data: { isDeleted: true, deletedAt: new Date() }
    });
      runInBackground(
        'Delete Record',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'delete',
        module: 'bonus-types',
        entity: 'BonusType',
        entityId: id,
        description: `Deleted bonus type ${existing.name}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      }),
      );
      return { status: true, message: 'Bonus type deleted successfully' };
    } catch (error: any) {
      
      runInBackground(
        'Failed to delete bonus type',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'delete',
        module: 'bonus-types',
        entity: 'BonusType',
        entityId: id,
        description: 'Failed to delete bonus type',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      }),
      );
      return { status: false, message: 'Failed to delete bonus type' };
    }
  }

  async updateBulk(
    items: {
      id: string;
      name: string;
      calculationType?: string;
      amount?: number;
      percentage?: number;
      status?: string;
    }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length) return { status: false, message: 'No items to update' };
    try {
      for (const i of items) {
        await this.prisma.bonusType.update({
          where: { id: i.id },
          data: {
            name: i.name,
            calculationType: i.calculationType ?? 'Amount',
            amount: i.amount ? Number(i.amount) : null,
            percentage: i.percentage ? Number(i.percentage) : null,
            status: i.status ?? 'active',
          },
        });
      }
      const response = { status: true, message: 'Operation completed successfully' };
      runInBackground(
        'Bulk Update Records',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'update',
        module: 'bonus-types',
        entity: 'BonusType',
        description: `Bulk updated ${items.length} bonus types`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      }),
      );
      return response;
    } catch (error: any) {
      
      runInBackground(
        'Failed bulk update bonus types',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'update',
        module: 'bonus-types',
        entity: 'BonusType',
        description: 'Failed bulk update bonus types',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      }),
      );
      return { status: false, message: 'Failed to update bonus types' };
    }
  }

  async removeBulk(
    ids: string[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!ids?.length) return { status: false, message: 'No items to delete' };
    try {
      for (const guardId of ids) {
        const deleteBlocked = await this.masterDeleteGuard.checkBlocked(this.prisma, 'bonusType', guardId);
        if (deleteBlocked) return { status: false, message: deleteBlocked };
      }

      await this.prisma.bonusType.updateMany({
        where: { id: { in: ids } },
          data: { isDeleted: true, deletedAt: new Date() }
    });
      runInBackground(
        'Bulk Delete Records',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'delete',
        module: 'bonus-types',
        entity: 'BonusType',
        description: `Bulk deleted ${ids.length} bonus types`,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      }),
      );
      return { status: true, message: 'Bonus types deleted successfully' };
    } catch (error: any) {
      runInBackground(
        'Failed bulk delete bonus types (Failure Log)',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'delete',
        module: 'bonus-types',
        entity: 'BonusType',
        description: 'Failed bulk delete bonus types',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      }),
      );
      return { status: false, message: 'Failed to delete bonus types' };
    }
  }
}
