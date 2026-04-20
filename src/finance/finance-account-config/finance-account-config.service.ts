import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AccountRoleKey,
  UpsertFinanceAccountConfigDto,
} from './dto/finance-account-config.dto';

@Injectable()
export class FinanceAccountConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /** Return all configured account roles with their linked account details. */
  async findAll() {
    const configs = await this.prisma.financeAccountConfig.findMany({
      include: { account: { select: { id: true, code: true, name: true, type: true } } },
      orderBy: { key: 'asc' },
    });
    return { status: true, data: configs };
  }

  /** Upsert a single role → account mapping. */
  async upsert(dto: UpsertFinanceAccountConfigDto) {
    const account = await this.prisma.chartOfAccount.findUnique({
      where: { id: dto.accountId },
      select: { id: true },
    });
    if (!account) {
      throw new BadRequestException(`ChartOfAccount not found: ${dto.accountId}`);
    }

    const config = await this.prisma.financeAccountConfig.upsert({
      where: { key: dto.key as any },
      create: {
        key: dto.key as any,
        accountId: dto.accountId,
        description: dto.description,
      },
      update: {
        accountId: dto.accountId,
        description: dto.description,
      },
      include: { account: { select: { id: true, code: true, name: true } } },
    });
    return { status: true, data: config };
  }

  /** Bulk upsert — save all role mappings in one call. */
  async bulkUpsert(configs: UpsertFinanceAccountConfigDto[]) {
    const results = await this.prisma.$transaction(
      configs.map((dto) =>
        this.prisma.financeAccountConfig.upsert({
          where: { key: dto.key as any },
          create: { key: dto.key as any, accountId: dto.accountId, description: dto.description },
          update: { accountId: dto.accountId, description: dto.description },
        }),
      ),
    );
    return { status: true, data: results };
  }

  /** Delete a role mapping (resets it to unconfigured). */
  async remove(key: AccountRoleKey) {
    await this.prisma.financeAccountConfig.delete({ where: { key: key as any } });
    return { status: true, message: `Config for ${key} removed` };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal helpers — used by other services to resolve account IDs
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Resolve a single account ID by role key.
   * Throws BadRequestException if not configured so callers get a clear message.
   */
  async resolveAccount(key: AccountRoleKey): Promise<string> {
    const config = await this.prisma.financeAccountConfig.findUnique({
      where: { key: key as any },
      select: { accountId: true },
    });
    if (!config) {
      throw new BadRequestException(
        `Finance account not configured for role "${key}". ` +
          `Please set it up in Finance → Account Configuration.`,
      );
    }
    return config.accountId;
  }

  /**
   * Resolve multiple keys at once. Returns a map of key → accountId.
   * Throws if any key is missing.
   */
  async resolveAccounts(
    keys: AccountRoleKey[],
  ): Promise<Record<AccountRoleKey, string>> {
    const configs = await this.prisma.financeAccountConfig.findMany({
      where: { key: { in: keys as any[] } },
      select: { key: true, accountId: true },
    });

    const map = Object.fromEntries(
      configs.map((c) => [c.key, c.accountId]),
    ) as Record<AccountRoleKey, string>;

    const missing = keys.filter((k) => !map[k]);
    if (missing.length > 0) {
      throw new BadRequestException(
        `Finance accounts not configured for roles: ${missing.join(', ')}. ` +
          `Please set them up in Finance → Account Configuration.`,
      );
    }
    return map;
  }
}
