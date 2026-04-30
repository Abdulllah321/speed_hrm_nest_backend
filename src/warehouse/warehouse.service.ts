import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Warehouse } from '@prisma/client';

import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { runInBackground } from '../common/utils/run-in-background.util';
@Injectable()
export class WarehouseService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) { }

  async createWarehouse(data: any, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }): Promise<Warehouse> {
    try {
      const created = await this.prisma.warehouse.create({ data });

      runInBackground(
        'Create Warehouse',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'warehouse',
          entity: 'Warehouse',
          entityId: created.id,
          description: `Created warehouse ${created.name}`,
          newValues: JSON.stringify(data),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return created;
    } catch (error: any) {
      runInBackground(
        'Create Warehouse (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'warehouse',
          entity: 'Warehouse',
          description: `Failed to create warehouse ${data.name}`,
          errorMessage: error?.message,
          newValues: JSON.stringify(data),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async findAllWarehouses(): Promise<Warehouse[]> {
    return this.prisma.warehouse.findMany({
      include: {
        _count: {
          select: { inventoryItems: true },
        },
      },
    });
  }

  async findOneWarehouse(id: string): Promise<Warehouse> {
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id },
      include: {
        inventoryItems: true,
      },
    });
    if (!warehouse)
      throw new NotFoundException(`Warehouse with ID ${id} not found`);
    return warehouse;
  }

  async updateWarehouse(id: string, data: any, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }): Promise<Warehouse> {
    try {
      const updated = await this.prisma.warehouse.update({
        where: { id },
        data,
      });

      runInBackground(
        'Update Warehouse',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'warehouse',
          entity: 'Warehouse',
          entityId: updated.id,
          description: `Updated warehouse ${updated.name}`,
          newValues: JSON.stringify(data),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return updated;
    } catch (error: any) {
      runInBackground(
        'Update Warehouse (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'warehouse',
          entity: 'Warehouse',
          entityId: id,
          description: `Failed to update warehouse`,
          errorMessage: error?.message,
          newValues: JSON.stringify(data),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async removeWarehouse(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }): Promise<Warehouse> {
    try {
      const removed = await this.prisma.warehouse.delete({ where: { id } });

      runInBackground(
        'Remove Warehouse',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'warehouse',
          entity: 'Warehouse',
          entityId: removed.id,
          description: `Deleted warehouse ${removed.name}`,
          oldValues: JSON.stringify(removed),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return removed;
    } catch (error: any) {
      runInBackground(
        'Remove Warehouse (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'warehouse',
          entity: 'Warehouse',
          entityId: id,
          description: `Failed to delete warehouse`,
          errorMessage: error?.message,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }
}
