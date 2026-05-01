import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
import {
  CreateChartOfAccountDto,
  UpdateChartOfAccountDto,
} from './dto/chart-of-account.dto';

@Injectable()
export class ChartOfAccountService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async create(
    createDto: CreateChartOfAccountDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const { code, parentId } = createDto;

      // Check for unique code
      const existing = await this.prisma.chartOfAccount.findFirst({
        where: { code },
      });
      if (existing) {
        throw new BadRequestException('Account code must be unique');
      }

      // Validate parent if provided
      if (parentId) {
        const parent = await this.prisma.chartOfAccount.findUnique({
          where: { id: parentId },
        });
        if (!parent) {
          throw new NotFoundException('Parent account not found');
        }
        if (!parent.isGroup) {
          throw new BadRequestException('Parent account must be a group account');
        }
      }

      const account = await this.prisma.chartOfAccount.create({
        data: {
          ...createDto,
          ...(ctx?.userId ? { createdById: ctx.userId } : {}),
        },
      });

      runInBackground(
        'Create Chart of Account',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'finance',
          entity: 'ChartOfAccount',
          entityId: account.id,
          description: `Created account ${account.name} (${account.code})`,
          newValues: JSON.stringify(createDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return account;
    } catch (error: any) {
      runInBackground(
        'Create Chart of Account (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'finance',
          entity: 'ChartOfAccount',
          description: `Failed to create account ${createDto.name}`,
          errorMessage: error?.message,
          newValues: JSON.stringify(createDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async findAll() {
    // Return all accounts, frontend can build the tree
    return this.prisma.chartOfAccount.findMany({
      orderBy: { code: 'asc' },
      include: {
        parent: {
          select: { id: true, name: true, code: true },
        },
      },
    });
  }

  async findOne(id: string) {
    const account = await this.prisma.chartOfAccount.findUnique({
      where: { id },
      include: {
        parent: true,
        children: true,
      },
    });

    if (!account) {
      throw new NotFoundException('Chart of account not found');
    }

    return account;
  }

  async update(
    id: string,
    updateDto: UpdateChartOfAccountDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const account = await this.prisma.chartOfAccount.findUnique({
        where: { id },
      });

      if (!account) {
        throw new NotFoundException('Chart of account not found');
      }

      // If changing code, check uniqueness
      if (updateDto.code && updateDto.code !== account.code) {
        const existing = await this.prisma.chartOfAccount.findFirst({
          where: { code: updateDto.code },
        });
        if (existing) {
          throw new BadRequestException('Account code must be unique');
        }
      }

      // Validate parent loop
      if (updateDto.parentId && updateDto.parentId !== account.parentId) {
        if (updateDto.parentId === id) {
          throw new BadRequestException('Account cannot be its own parent');
        }
        // Basic cycle check (only 1 level deep check for now, or recursive could be added)
        const parent = await this.prisma.chartOfAccount.findUnique({
          where: { id: updateDto.parentId },
        });
        if (!parent) throw new NotFoundException('Parent account not found');
        if (!parent.isGroup)
          throw new BadRequestException('Parent account must be a group');
      }

      const updatedAccount = await this.prisma.chartOfAccount.update({
        where: { id },
        data: {
          ...updateDto,
        },
      });

      runInBackground(
        'Update Chart of Account',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'finance',
          entity: 'ChartOfAccount',
          entityId: id,
          description: `Updated account ${updatedAccount.name} (${updatedAccount.code})`,
          oldValues: JSON.stringify(account),
          newValues: JSON.stringify(updateDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return updatedAccount;
    } catch (error: any) {
      runInBackground(
        'Update Chart of Account (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'finance',
          entity: 'ChartOfAccount',
          entityId: id,
          description: `Failed to update account ${id}`,
          errorMessage: error?.message,
          newValues: JSON.stringify(updateDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async remove(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const account = await this.prisma.chartOfAccount.findUnique({
        where: { id },
        include: { children: true },
      });

      if (!account) {
        throw new NotFoundException('Chart of account not found');
      }

      if (account.children && account.children.length > 0) {
        throw new BadRequestException(
          'Cannot delete account with children. Delete or move children first.',
        );
      }

      const deletedAccount = await this.prisma.chartOfAccount.delete({
        where: { id },
      });

      runInBackground(
        'Delete Chart of Account',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'finance',
          entity: 'ChartOfAccount',
          entityId: id,
          description: `Deleted account ${deletedAccount.name} (${deletedAccount.code})`,
          oldValues: JSON.stringify(account),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return deletedAccount;
    } catch (error: any) {
      runInBackground(
        'Delete Chart of Account (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'finance',
          entity: 'ChartOfAccount',
          entityId: id,
          description: `Failed to delete account ${id}`,
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
