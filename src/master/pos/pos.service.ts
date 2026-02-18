import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { CreatePosDto } from './dto/create-pos.dto';
import { UpdatePosDto } from './dto/update-pos.dto';
import { generateNextPosId } from '../../common/utils/pos-id-generator';

@Injectable()
export class PosService {
  constructor(
    private prismaMaster: PrismaMasterService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list(locationId?: string) {
    const items = await this.prismaMaster.pos.findMany({
      where: locationId ? { locationId } : {},
      include: { location: true },
      orderBy: { createdAt: 'desc' },
    });
    return { status: true, data: items };
  }

  async get(id: string) {
    const item = await this.prismaMaster.pos.findUnique({
      where: { id },
      include: { location: true },
    });
    if (!item) return { status: false, message: 'POS not found' };
    return { status: true, data: item };
  }

  async create(
    body: CreatePosDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      // Get existing POS IDs for this location to generate the next sequential ID
      const existingPos = await this.prismaMaster.pos.findMany({
        where: { locationId: body.locationId },
        select: { posId: true },
      });
      const existingIds = existingPos.map((p) => p.posId);
      const nextPosId = generateNextPosId(existingIds);

      const created = await this.prismaMaster.pos.create({
        data: {
          name: body.name,
          locationId: body.locationId,
          posId: nextPosId,
          status: body.status ?? 'active',
          createdById: ctx.userId,
        },
      });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'pos',
        entity: 'Pos',
        entityId: created.id,
        description: `Created POS ${created.name} (${created.posId}) for location ${created.locationId}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, data: created };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'pos',
        entity: 'Pos',
        description: 'Failed to create POS',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message: error?.message || 'Failed to create POS',
      };
    }
  }

  async update(
    id: string,
    body: UpdatePosDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prismaMaster.pos.findUnique({
        where: { id },
      });
      if (!existing) return { status: false, message: 'POS not found' };

      const updated = await this.prismaMaster.pos.update({
        where: { id },
        data: {
          name: body.name ?? existing.name,
          status: body.status ?? existing.status,
        },
      });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'pos',
        entity: 'Pos',
        entityId: id,
        description: `Updated POS ${updated.name}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, data: updated };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'pos',
        entity: 'Pos',
        entityId: id,
        description: 'Failed to update POS',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message: error?.message || 'Failed to update POS',
      };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prismaMaster.pos.findUnique({
        where: { id },
      });
      if (!existing) return { status: false, message: 'POS not found' };

      const removed = await this.prismaMaster.pos.delete({
        where: { id },
      });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'pos',
        entity: 'Pos',
        entityId: id,
        description: `Deleted POS ${existing.name}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, data: removed };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'pos',
        entity: 'Pos',
        entityId: id,
        description: 'Failed to delete POS',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to delete POS' };
    }
  }
}
