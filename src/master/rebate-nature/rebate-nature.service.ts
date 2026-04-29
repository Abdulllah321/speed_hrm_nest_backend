import { PrismaService } from '../../database/prisma.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { CreateRebateNatureDto } from './dto/create-rebate-nature.dto';
import { UpdateRebateNatureDto } from './dto/update-rebate-nature.dto';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';

@Injectable()
export class RebateNatureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLogs: ActivityLogsService,
  ) {}

  async create(
    createRebateNatureDto: CreateRebateNatureDto,
    userId: string,
    ctx?: { ipAddress?: string; userAgent?: string },
  ) {
    try {
      const created = await this.prisma.rebateNature.create({
        data: {
          ...createRebateNatureDto,
          createdById: userId,
        },
      });
      const response = { status: true, data: created };
      runInBackground(
        'Create Rebate Nature',
        this.activityLogs.log({
          userId,
          action: 'create',
          module: 'rebate-natures',
          entity: 'RebateNature',
          entityId: created.id,
          description: `Created rebate nature ${created.name}`,
          newValues: JSON.stringify(createRebateNatureDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );
      return response;
    } catch (error: any) {
      runInBackground(
        'Create Rebate Nature (Failure Log)',
        this.activityLogs.log({
          userId,
          action: 'create',
          module: 'rebate-natures',
          entity: 'RebateNature',
          description: 'Failed to create rebate nature',
          errorMessage: error?.message,
          newValues: JSON.stringify(createRebateNatureDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async findAll() {
    return this.prisma.rebateNature.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findFixedRebateNatures() {
    const fixedNatures = await this.prisma.rebateNature.findMany({
      where: {
        type: 'fixed',
        status: 'active',
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    // Group by category
    const grouped = fixedNatures.reduce(
      (acc, nature) => {
        const category = nature.category || 'Other';
        if (!acc[category]) {
          acc[category] = [];
        }
        acc[category].push(nature);
        return acc;
      },
      {} as Record<string, typeof fixedNatures>,
    );

    return grouped;
  }

  async findAllByType(type: 'fixed' | 'other') {
    return this.prisma.rebateNature.findMany({
      where: {
        type,
        status: 'active',
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    const rebateNature = await this.prisma.rebateNature.findUnique({
      where: { id },
    });

    if (!rebateNature) {
      throw new NotFoundException(`RebateNature with ID ${id} not found`);
    }

    return rebateNature;
  }

  async update(
    id: string,
    updateRebateNatureDto: UpdateRebateNatureDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.findOne(id); // Ensure exists

      const updated = await this.prisma.rebateNature.update({
        where: { id },
        data: updateRebateNatureDto,
      });
      const response = { status: true, data: updated };
      runInBackground(
        'Update Rebate Nature',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'rebate-natures',
          entity: 'RebateNature',
          entityId: id,
          description: `Updated rebate nature ${updated.name}`,
          oldValues: JSON.stringify(existing),
          newValues: JSON.stringify(updateRebateNatureDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );
      return response;
    } catch (error: any) {
      runInBackground(
        'Update Rebate Nature (Failure Log)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'rebate-natures',
          entity: 'RebateNature',
          entityId: id,
          description: 'Failed to update rebate nature',
          errorMessage: error?.message,
          newValues: JSON.stringify(updateRebateNatureDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async remove(
    id: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.findOne(id); // Ensure exists

      const removed = await this.prisma.rebateNature.delete({
        where: { id },
      });
      const response = { status: true, data: removed };
      runInBackground(
        'Delete Rebate Nature',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'rebate-natures',
          entity: 'RebateNature',
          entityId: id,
          description: `Deleted rebate nature ${existing.name}`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );
      return response;
    } catch (error: any) {
      runInBackground(
        'Delete Rebate Nature (Failure Log)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'rebate-natures',
          entity: 'RebateNature',
          entityId: id,
          description: 'Failed to delete rebate nature',
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
