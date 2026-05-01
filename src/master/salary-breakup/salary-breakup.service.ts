import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { runInBackground } from '../../common/utils/run-in-background.util';

@Injectable()
export class SalaryBreakupService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list() {
    const items = await this.prisma.salaryBreakup.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { status: true, data: items };
  }

  async get(id: string) {
    const item = await this.prisma.salaryBreakup.findUnique({
      where: { id },
    });
    if (!item) return { status: false, message: 'Salary breakup not found' };
    return { status: true, data: item };
  }

  async create(
    body: {
      name: string;
      percentage: number;
      isTaxable?: boolean;
      isDeductible?: boolean;
      status?: string;
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const created = await this.prisma.salaryBreakup.create({
        data: {
          name: body.name,
          percentage: body.percentage,
          details:
            body.isTaxable !== undefined || body.isDeductible !== undefined
              ? JSON.stringify({ 
                  isTaxable: body.isTaxable,
                  isDeductible: body.isDeductible 
                })
              : null,
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
        module: 'salary-breakups',
        entity: 'SalaryBreakup',
        entityId: created.id,
        description: `Created salary breakup ${created.name}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      }),
      );
      return { status: true, message: 'Created successfully' };
    } catch (error: any) {
      
      runInBackground(
        'Failed to create salary breakup',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'create',
        module: 'salary-breakups',
        entity: 'SalaryBreakup',
        description: 'Failed to create salary breakup',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
        }),
      );
      return { status: false, message: 'Failed to create salary breakup' };
    }
  }

  async update(
    id: string,
    body: {
      name: string;
      percentage: number;
      isTaxable?: boolean;
      isDeductible?: boolean;
      status?: string;
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.salaryBreakup.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Salary breakup not found' };
      }

      // Parse existing details
      let existingDetails: any = {};
      try {
        if (existing.details) {
          existingDetails = typeof existing.details === 'string' 
            ? JSON.parse(existing.details) 
            : existing.details;
        }
      } catch (e) {
        existingDetails = {};
      }

      // Merge with new values
      const updatedDetails = {
        ...existingDetails,
        ...(body.isTaxable !== undefined && { isTaxable: body.isTaxable }),
        ...(body.isDeductible !== undefined && { isDeductible: body.isDeductible }),
      };

      const updated = await this.prisma.salaryBreakup.update({
        where: { id },
        data: {
          name: body.name,
          percentage: body.percentage,
          details: JSON.stringify(updatedDetails),
          status: body.status ?? existing.status,
        },
      });

      const response = { status: true, data: updated };
      runInBackground(
        'Update Record',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'update',
        module: 'salary-breakups',
        entity: 'SalaryBreakup',
        entityId: updated.id,
        description: `Updated salary breakup ${updated.name}`,
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
        'Failed to update salary breakup',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'update',
        module: 'salary-breakups',
        entity: 'SalaryBreakup',
        entityId: id,
        description: 'Failed to update salary breakup',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      }),
      );

      return {
        status: false,
        message: error?.message || 'Failed to update salary breakup',
      };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.salaryBreakup.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Salary breakup not found' };
      }

      await this.prisma.salaryBreakup.delete({ where: { id } });

      runInBackground(
        'Delete Record',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'delete',
        module: 'salary-breakups',
        entity: 'SalaryBreakup',
        entityId: id,
        description: `Deleted salary breakup ${existing.name}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      }),
      );
      return { status: true, message: 'Deleted successfully' };
    } catch (error: any) {
      runInBackground(
        'Failed to delete salary breakup (Failure Log)',
        this.activityLogs.log({
          userId: ctx.userId,
        action: 'delete',
        module: 'salary-breakups',
        entity: 'SalaryBreakup',
        entityId: id,
        description: 'Failed to delete salary breakup',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      }),
      );

      return {
        status: false,
        message: error?.message || 'Failed to delete salary breakup',
      };
    }
  }
}
