import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityLogsService } from '../activity-logs/activity-logs.service'
import { UpdateMaritalStatusDto, BulkUpdateMaritalStatusItemDto } from './dto/marital-status.dto'

@Injectable()
export class MaritalStatusService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) { }

  async list() {
    const items = await this.prisma.maritalStatus.findMany({ orderBy: { createdAt: 'desc' } })
    return { status: true, data: items }
  }

  async get(id: string) {
    const item = await this.prisma.maritalStatus.findUnique({ where: { id } })
    if (!item) return { status: false, message: 'Marital status not found' }
    return { status: true, data: item }
  }

  async bulkCreate(names: string[], ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      // Filter out empty names and map to objects
      const validData = names
        .filter((name) => name && typeof name === 'string' && name.trim().length > 0)
        .map(name => ({
          name: name.trim(),
          status: 'active',
          createdById: ctx?.userId,
        }));

      if (validData.length === 0) {
        return { status: false, message: 'No valid data provided' };
      }

      const result = await this.prisma.maritalStatus.createMany({
        data: validData,
        skipDuplicates: true,
      });

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'create',
        module: 'marital-statuses',
        entity: 'MaritalStatus',
        description: `Created marital statuses (${result.count})`,
        newValues: JSON.stringify(names),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });

      return { status: true, message: 'Marital statuses created successfully', data: result };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'create',
        module: 'marital-statuses',
        entity: 'MaritalStatus',
        description: 'Failed to create marital statuses',
        errorMessage: error?.message,
        newValues: JSON.stringify(names),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'failure',
      });
      return { status: false, message: error?.message || 'Failed to create marital statuses' };
    }
  }

  async update(id: string, updateDto: UpdateMaritalStatusDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.maritalStatus.findUnique({ where: { id } });
      if (!existing) {
        return { status: false, message: 'Marital status not found' };
      }

      const updated = await this.prisma.maritalStatus.update({
        where: { id },
        data: {
          name: updateDto.name,
          status: updateDto.status ?? existing.status,
        },
      });

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'marital-statuses',
        entity: 'MaritalStatus',
        entityId: id,
        description: `Updated marital status ${updated.name}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(updateDto),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });

      return { status: true, data: updated, message: 'Marital status updated successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'marital-statuses',
        entity: 'MaritalStatus',
        entityId: id,
        description: 'Failed to update marital status',
        errorMessage: error?.message,
        newValues: JSON.stringify(updateDto),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'failure',
      });
      return { status: false, message: error?.message || 'Failed to update marital status' };
    }
  }

  async remove(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.maritalStatus.findUnique({ where: { id } });
      if (!existing) {
        return { status: false, message: 'Marital status not found' };
      }

      const removed = await this.prisma.maritalStatus.delete({ where: { id } });

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'marital-statuses',
        entity: 'MaritalStatus',
        entityId: id,
        description: `Deleted marital status ${existing.name}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });

      return { status: true, data: removed, message: 'Marital status deleted successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'marital-statuses',
        entity: 'MaritalStatus',
        entityId: id,
        description: 'Failed to delete marital status',
        errorMessage: error?.message,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'failure',
      });
      return { status: false, message: error?.message || 'Failed to delete marital status' };
    }
  }

  async updateBulk(items: BulkUpdateMaritalStatusItemDto[], ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      // Filter out items with empty or invalid IDs
      const validItems = (items || []).filter(item => item.id && item.id.trim().length > 0);
      if (validItems.length === 0) {
        return { status: false, message: 'No valid marital status IDs provided' };
      }

      const updatedItems: any[] = [];
      for (const item of validItems) {
        if (!item.id) {
          continue;
        }
        const updated = await this.prisma.maritalStatus.update({
          where: { id: item.id },
          data: {
            name: item.name,
            status: item.status ?? 'active',
          },
        });
        updatedItems.push(updated);
      }

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'marital-statuses',
        entity: 'MaritalStatus',
        description: `Bulk updated marital statuses (${updatedItems.length})`,
        newValues: JSON.stringify(items),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });

      return { status: true, data: updatedItems, message: 'Marital statuses updated successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'marital-statuses',
        entity: 'MaritalStatus',
        description: 'Failed bulk update marital statuses',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'failure',
      });
      return { status: false, message: error?.message || 'Failed to update marital statuses' };
    }
  }

  async removeBulk(ids: string[], ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      if (!ids || ids.length === 0) {
        return { status: false, message: 'No IDs provided' };
      }

      const result = await this.prisma.maritalStatus.deleteMany({
        where: { id: { in: ids } },
      });

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'marital-statuses',
        entity: 'MaritalStatus',
        description: `Bulk deleted marital statuses (${result.count})`,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });

      return { status: true, data: result, message: 'Marital statuses deleted successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'marital-statuses',
        entity: 'MaritalStatus',
        description: 'Failed bulk delete marital statuses',
        errorMessage: error?.message,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'failure',
      });
      return { status: false, message: error?.message || 'Failed to delete marital statuses' };
    }
  }
}
