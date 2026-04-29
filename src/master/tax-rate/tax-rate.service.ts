import { PrismaService } from '../../database/prisma.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { CreateTaxRateDto, UpdateTaxRateDto } from './tax-rate.dto';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';

@Injectable()
export class TaxRateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLogs: ActivityLogsService,
  ) {}

  async create(
    dto: CreateTaxRateDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const data = await this.prisma.taxRate1.create({
        data: {
          taxRate1: dto.taxRate1 ?? 0,
        },
      });
      const response = { status: true, data };
      runInBackground(
        'Create Tax Rate',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'tax-rates',
          entity: 'TaxRate',
          entityId: data.id,
          description: `Created tax rate ${dto.taxRate1}%`,
          newValues: JSON.stringify(dto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );
      return response;
    } catch (error: any) {
      runInBackground(
        'Create Tax Rate (Failure Log)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'tax-rates',
          entity: 'TaxRate',
          description: 'Failed to create tax rate',
          errorMessage: error?.message,
          newValues: JSON.stringify(dto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: 'Failed to create tax rate' };
    }
  }

  async list() {
    const items = await this.prisma.taxRate1.findMany({
      orderBy: [{ createdAt: 'desc' }],
    });
    return { status: true, data: items };
  }

  async get(id: string) {
    const item = await this.prisma.taxRate1.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException('Tax Rate not found');
    }
    return { status: true, data: item };
  }

  async update(
    id: string,
    dto: UpdateTaxRateDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.get(id);
      const data = await this.prisma.taxRate1.update({
        where: { id },
        data: {
          taxRate1: dto.taxRate1 ?? undefined,
        },
      });
      const response = { status: true, data };
      runInBackground(
        'Update Tax Rate',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'tax-rates',
          entity: 'TaxRate',
          entityId: id,
          description: `Updated tax rate to ${dto.taxRate1}%`,
          oldValues: JSON.stringify(existing.data),
          newValues: JSON.stringify(dto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );
      return response;
    } catch (error: any) {
      runInBackground(
        'Update Tax Rate (Failure Log)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'tax-rates',
          entity: 'TaxRate',
          entityId: id,
          description: 'Failed to update tax rate',
          errorMessage: error?.message,
          newValues: JSON.stringify(dto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: 'Failed to update tax rate' };
    }
  }

  async remove(
    id: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.get(id);
      await this.prisma.taxRate1.delete({ where: { id } });
      const response = { status: true };
      runInBackground(
        'Delete Tax Rate',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'tax-rates',
          entity: 'TaxRate',
          entityId: id,
          description: `Deleted tax rate ${existing.data.taxRate1}%`,
          oldValues: JSON.stringify(existing.data),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );
      return response;
    } catch (error: any) {
      runInBackground(
        'Delete Tax Rate (Failure Log)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'tax-rates',
          entity: 'TaxRate',
          entityId: id,
          description: 'Failed to delete tax rate',
          errorMessage: error?.message,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: 'Failed to delete tax rate' };
    }
  }
}
