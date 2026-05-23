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
  AccountType,
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
    // Fetch all accounts in one query
    const accounts = await this.prisma.chartOfAccount.findMany({
      orderBy: { code: 'asc' },
      include: {
        parent: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    // Build a map for O(1) lookup with debit/credit separation
    const map = new Map<string, (typeof accounts)[0] & { balance: any; debit: number; credit: number }>();
    for (const acc of accounts) {
      const balance = Number(acc.balance);
      map.set(acc.id, { 
        ...acc, 
        debit: balance > 0 ? balance : 0,
        credit: balance < 0 ? Math.abs(balance) : 0
      });
    }

    // Compute rolled-up balances bottom-up:
    // Process in reverse order so children are handled before parents
    // (works because accounts are ordered by code, children always have longer codes)
    const sorted = [...map.values()];

    // Reset group balances to 0 before rolling up
    const parentIds = new Set(accounts.map((a) => a.parentId).filter(Boolean));
    for (const acc of sorted) {
      if (acc.isGroup || parentIds.has(acc.id)) {
        (acc as any).balance = 0;
        (acc as any).debit = 0;
        (acc as any).credit = 0;
      }
    }

    // Propagate leaf balances up the tree
    for (const acc of sorted) {
      if (!acc.isGroup && acc.parentId) {
        let currentParentId: string | null = acc.parentId;
        const leafBalance = Number(acc.balance);
        const leafDebit = (acc as any).debit;
        const leafCredit = (acc as any).credit;

        while (currentParentId) {
          const parent = map.get(currentParentId);
          if (!parent) break;
          (parent as any).balance = Number((parent as any).balance) + leafBalance;
          (parent as any).debit = Number((parent as any).debit) + leafDebit;
          (parent as any).credit = Number((parent as any).credit) + leafCredit;
          currentParentId = parent.parentId ?? null;
        }
      }
    }

    return [...map.values()];
  }

  async findTree() {    // Fetch all accounts flat, ordered by code so parents always precede children
    const accounts = await this.prisma.chartOfAccount.findMany({
      orderBy: { code: 'asc' },
    });

    // Build id → node map with an empty children array
    type TreeNode = (typeof accounts)[0] & { children: TreeNode[] };
    const map = new Map<string, TreeNode>();
    for (const acc of accounts) {
      map.set(acc.id, { ...acc, children: [] });
    }

    // Wire up parent → children relationships
    const roots: TreeNode[] = [];
    for (const node of map.values()) {
      if (node.parentId && map.has(node.parentId)) {
        map.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  /** Returns direct children of an account (for tag-account selection). */
  async findChildAccounts(accountId: string) {
    const account = await this.prisma.chartOfAccount.findUnique({
      where: { id: accountId },
      include: {
        children: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            isGroup: true,
            isActive: true,
          },
          orderBy: { code: 'asc' },
        },
      },
    });

    if (!account) {
      throw new NotFoundException('Chart of account not found');
    }

    return account.children;
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

  /**
   * Recursively update account type for all descendants
   */
  private async updateChildrenAccountType(
    parentId: string,
    newType: AccountType,
  ): Promise<void> {
    // Find all direct children
    const children = await this.prisma.chartOfAccount.findMany({
      where: { parentId },
      select: { id: true },
    });

    if (children.length === 0) return;

    // Update all direct children
    await this.prisma.chartOfAccount.updateMany({
      where: { parentId },
      data: { type: newType },
    });

    // Recursively update grandchildren and beyond
    for (const child of children) {
      await this.updateChildrenAccountType(child.id, newType);
    }
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

      // Check if parent is changing
      let newParentType: any = null;
      if (updateDto.parentId && updateDto.parentId !== account.parentId) {
        if (updateDto.parentId === id) {
          throw new BadRequestException('Account cannot be its own parent');
        }
        // Basic cycle check (only 1 level deep check for now, or recursive could be added)
        const parent = await this.prisma.chartOfAccount.findUnique({
          where: { id: updateDto.parentId },
        });
        if (!parent) throw new NotFoundException('Parent account not found');
        
        // Store parent's type to inherit
        newParentType = parent.type as AccountType;
      }

      // Check if account type is being changed explicitly
      const isTypeChanging = updateDto.type && updateDto.type !== account.type;

      // If parent is changing and type is not explicitly set, inherit parent's type
      if (newParentType && !updateDto.type) {
        updateDto.type = newParentType as AccountType;
      }

      const updatedAccount = await this.prisma.chartOfAccount.update({
        where: { id },
        data: {
          ...updateDto,
        },
      });

      // If type changed (either explicitly or inherited from parent), update all descendants
      if (isTypeChanging || newParentType) {
        const finalType = updateDto.type || newParentType;
        await this.updateChildrenAccountType(id, finalType);
      }

      runInBackground(
        'Update Chart of Account',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'finance',
          entity: 'ChartOfAccount',
          entityId: id,
          description: `Updated account ${updatedAccount.name} (${updatedAccount.code})${isTypeChanging || newParentType ? ' and all child accounts' : ''}`,
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

  async createBulkSubAccounts(
    body: {
      parentId: string;
      items: {
        name: string;
        code: string;
        type: 'SUPPLIER' | 'CUSTOMER' | 'LOCATION' | 'DIRECTOR' | 'EMPLOYEE' | 'MERCHANDISE' | 'SALARY' | 'TAX';
        referenceId: string;
      }[];
    },
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const { parentId, items } = body;

      const parent = await this.prisma.chartOfAccount.findUnique({
        where: { id: parentId },
      });
      if (!parent) {
        throw new NotFoundException('Parent account not found');
      }

      const created: any[] = [];
      const skipped: any[] = [];

      for (const item of items) {
        const existing = await this.prisma.chartOfAccount.findFirst({
          where: { code: item.code },
        });

        if (existing) {
          skipped.push({
            name: item.name,
            code: item.code,
            reason: 'Account code already exists',
          });
          continue;
        }

        const data: any = {
          code: item.code,
          name: item.name,
          type: parent.type,
          parentId: parent.id,
          isGroup: false,
          isActive: true,
          ...(ctx?.userId ? { createdById: ctx.userId } : {}),
        };

        if (item.type === 'SUPPLIER' || item.type === 'MERCHANDISE') {
          data.suppliers = {
            connect: [{ id: item.referenceId }],
          };
        }

        const account = await this.prisma.chartOfAccount.create({
          data,
        });
        created.push(account);
      }

      runInBackground(
        'Bulk Create Sub-accounts',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'finance',
          entity: 'ChartOfAccount',
          description: `Bulk created ${created.length} sub-accounts under ${parent.name} (${parent.code}). Skipped ${skipped.length}.`,
          newValues: JSON.stringify(body),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return {
        status: true,
        message: `Successfully created ${created.length} sub-accounts.`,
        createdCount: created.length,
        skippedCount: skipped.length,
        created,
        skipped,
      };
    } catch (error: any) {
      runInBackground(
        'Bulk Create Sub-accounts (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'finance',
          entity: 'ChartOfAccount',
          description: `Failed bulk sub-accounts creation under parent ${body.parentId}`,
          errorMessage: error?.message,
          newValues: JSON.stringify(body),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }
}
