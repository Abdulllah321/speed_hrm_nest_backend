import { Injectable } from '@nestjs/common';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { PrismaService } from '../../database/prisma.service';

import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';

@Injectable()
export class EobiService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list() {
    const items = await this.prisma.eOBI.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { status: true, data: items };
  }

  async get(id: string) {
    const item = await this.prisma.eOBI.findUnique({ where: { id } });
    if (!item) return { status: false, message: 'EOBI not found' };
    return { status: true, data: item };
  }

  async create(
    body: {
      name: string;
      eobiId?: string;
      eobiCode?: string;
      amount?: number;
      employerContribution: number;
      employeeContribution: number;
      yearMonth: string;
      status?: string;
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const created = await this.prisma.eOBI.create({
        data: {
          name: body.name,
          eobiId: body.eobiId || null,
          eobiCode: body.eobiCode || null,
          amount: body.amount ? (body.amount as any) : null,
          employerContribution: body.employerContribution as any,
          employeeContribution: body.employeeContribution as any,
          yearMonth: body.yearMonth,
          status: body.status ?? 'active',
          createdById: ctx.userId,
        },
      });
      const response = { status: true, data: created, message: 'Created successfully' };
      runInBackground(
        'Create Record',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'create',
        module: 'eobis',
        entity: 'EOBI',
        entityId: created.id,
        description: `Created EOBI ${created.name}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      }),
      );
      return response;
    } catch (error: any) {
      
      runInBackground(
        'Failed to create EOBI',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'create',
        module: 'eobis',
        entity: 'EOBI',
        description: 'Failed to create EOBI',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
        }),
      );
      return { status: false, message: 'Failed to create EOBI' };
    }
  }

  async createBulk(
    items: {
      name: string;
      eobiId?: string;
      eobiCode?: string;
      amount?: number;
      employerContribution: number;
      employeeContribution: number;
      yearMonth: string;
      status?: string;
    }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length) return { status: false, message: 'No items to create' };
    try {
      const res = await this.prisma.eOBI.createMany({
        data: items.map((i) => ({
          name: i.name,
          eobiId: i.eobiId || null,
          eobiCode: i.eobiCode || null,
          amount: i.amount ? (i.amount as any) : null,
          employerContribution: i.employerContribution as any,
          employeeContribution: i.employeeContribution as any,
          yearMonth: i.yearMonth,
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
        module: 'eobis',
        entity: 'EOBI',
        description: `Bulk created ${res.count} EOBIs`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      }),
      );
      return { status: true, message: 'EOBIs created successfully' };
    } catch (error: any) {

      runInBackground(
        'Failed bulk create EOBIs',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'create',
        module: 'eobis',
        entity: 'EOBI',
        description: 'Failed bulk create EOBIs',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      }),
      );
      return { status: false, message: 'Failed to create EOBIs' };
    }
  }

  async update(
    id: string,
    body: {
      name?: string;
      eobiId?: string;
      eobiCode?: string;
      amount?: number;
      employerContribution?: number;
      employeeContribution?: number;
      yearMonth?: string;
      status?: string;
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.eOBI.findUnique({
        where: { id },
      });
      if (!existing) return { status: false, message: 'EOBI not found' };
      const updated = await this.prisma.eOBI.update({
        where: { id },
        data: {
          name: body.name ?? existing.name,
          eobiId:
            body.eobiId !== undefined ? body.eobiId || null : existing.eobiId,
          eobiCode:
            body.eobiCode !== undefined
              ? body.eobiCode || null
              : existing.eobiCode,
          amount:
            body.amount !== undefined ? (body.amount as any) : existing.amount,
          employerContribution:
            body.employerContribution !== undefined
              ? (body.employerContribution as any)
              : existing.employerContribution,
          employeeContribution:
            body.employeeContribution !== undefined
              ? (body.employeeContribution as any)
              : existing.employeeContribution,
          yearMonth: body.yearMonth ?? existing.yearMonth,
          status: body.status ?? existing.status,
        },
      });
      const response = { status: true, data: updated };
      runInBackground(
        'Update Record',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'update',
        module: 'eobis',
        entity: 'EOBI',
        entityId: id,
        description: `Updated EOBI ${updated.name}`,
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
        'Failed to update EOBI',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'update',
        module: 'eobis',
        entity: 'EOBI',
        entityId: id,
        description: 'Failed to update EOBI',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      }),
      );
      return { status: false, message: 'Failed to update EOBI' };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.eOBI.findUnique({
        where: { id },
      });
      if (!existing) return { status: false, message: 'EOBI not found' };
      await this.prisma.eOBI.delete({ where: { id } });
      runInBackground(
        'Delete Record',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'delete',
        module: 'eobis',
        entity: 'EOBI',
        entityId: id,
        description: `Deleted EOBI ${existing.name}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      }),
      );
      return { status: true, message: 'EOBI deleted successfully' };
    } catch (error: any) {
      
      runInBackground(
        'Failed to delete EOBI',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'delete',
        module: 'eobis',
        entity: 'EOBI',
        entityId: id,
        description: 'Failed to delete EOBI',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      }),
      );
      return { status: false, message: 'Failed to delete EOBI' };
    }
  }

  async removeBulk(
    ids: string[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!ids?.length) return { status: false, message: 'No items to delete' };
    try {
      await this.prisma.eOBI.deleteMany({ where: { id: { in: ids } } });
      runInBackground(
        'Bulk Delete Records',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'delete',
        module: 'eobis',
        entity: 'EOBI',
        description: `Bulk deleted ${ids.length} EOBIs`,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      }),
      );
      return { status: true, message: 'EOBIs deleted successfully' };
    } catch (error: any) {
      
      runInBackground(
        'Failed bulk delete EOBIs',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'delete',
        module: 'eobis',
        entity: 'EOBI',
        description: 'Failed bulk delete EOBIs',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      }),
      );
      return { status: false, message: 'Failed to delete EOBIs' };
    }
  }

  async updateBulk(
    items: {
      id: string;
      name: string;
      eobiId?: string;
      eobiCode?: string;
      amount?: number;
      employerContribution: number;
      employeeContribution: number;
      yearMonth: string;
      status?: string;
    }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length) return { status: false, message: 'No items to update' };
    try {
      for (const i of items) {
        await this.prisma.eOBI.update({
          where: { id: i.id },
          data: {
            name: i.name,
            eobiId: i.eobiId || null,
            eobiCode: i.eobiCode || null,
            amount: i.amount ? (i.amount as any) : null,
            employerContribution: i.employerContribution as any,
            employeeContribution: i.employeeContribution as any,
            yearMonth: i.yearMonth,
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
        module: 'eobis',
        entity: 'EOBI',
        description: `Bulk updated ${items.length} EOBIs`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      }),
      );
      return response;
    } catch (error: any) {
      runInBackground(
        'Failed bulk update EOBIs (Failure Log)',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'update',
        module: 'eobis',
        entity: 'EOBI',
        description: 'Failed bulk update EOBIs',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      }),
      );
      return { status: false, message: 'Failed to update EOBIs' };
    }
  }
}
