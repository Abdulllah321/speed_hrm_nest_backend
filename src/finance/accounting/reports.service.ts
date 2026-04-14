import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountType } from '@prisma/client';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // TRIAL BALANCE
  // Returns all leaf accounts with their debit/credit totals for a period.
  // If no date range is given, uses the running balance on ChartOfAccount.
  // ─────────────────────────────────────────────────────────────────────────
  async getTrialBalance(from?: string, to?: string) {
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { isGroup: false, isActive: true },
      select: { id: true, code: true, name: true, type: true, balance: true,
        parent: { select: { code: true, name: true } } },
      orderBy: { code: 'asc' },
    });

    if (!from && !to) {
      // Use stored running balances
      let totalDebit = 0, totalCredit = 0;
      const rows = accounts.map(a => {
        const bal = Number(a.balance);
        const isDebitNormal = a.type === AccountType.ASSET || a.type === AccountType.EXPENSE;
        const debit  = isDebitNormal && bal > 0 ? bal : (!isDebitNormal && bal < 0 ? -bal : 0);
        const credit = !isDebitNormal && bal > 0 ? bal : (isDebitNormal && bal < 0 ? -bal : 0);
        totalDebit  += debit;
        totalCredit += credit;
        return { ...a, balance: bal, debit, credit };
      });
      return { rows, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 };
    }

    // Period-based: aggregate transactions
    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(from);
    if (to)   dateFilter.lte = new Date(to);

    const txAgg = await this.prisma.accountTransaction.groupBy({
      by: ['accountId'],
      where: { transactionDate: dateFilter },
      _sum: { debit: true, credit: true },
    });

    const txMap = new Map(txAgg.map(t => [t.accountId, {
      debit:  Number(t._sum.debit  ?? 0),
      credit: Number(t._sum.credit ?? 0),
    }]));

    let totalDebit = 0, totalCredit = 0;
    const rows = accounts.map(a => {
      const tx = txMap.get(a.id) ?? { debit: 0, credit: 0 };
      totalDebit  += tx.debit;
      totalCredit += tx.credit;
      return { ...a, balance: Number(a.balance), debit: tx.debit, credit: tx.credit };
    }).filter(r => r.debit !== 0 || r.credit !== 0);

    return { rows, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01, from, to };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GENERAL LEDGER  (per account, with opening balance)
  // ─────────────────────────────────────────────────────────────────────────
  async getGeneralLedger(
    accountId: string,
    from?: string,
    to?: string,
    page = 1,
    limit = 50,
  ) {
    const account = await this.prisma.chartOfAccount.findUnique({
      where: { id: accountId },
      select: { id: true, code: true, name: true, type: true, balance: true },
    });
    if (!account) throw new NotFoundException('Account not found');

    // Opening balance = sum of all transactions BEFORE `from`
    let openingBalance = 0;
    if (from) {
      const before = await this.prisma.accountTransaction.aggregate({
        where: { accountId, transactionDate: { lt: new Date(from) } },
        _sum: { debit: true, credit: true },
      });
      const isDebitNormal = account.type === AccountType.ASSET || account.type === AccountType.EXPENSE;
      const d = Number(before._sum.debit ?? 0);
      const c = Number(before._sum.credit ?? 0);
      openingBalance = isDebitNormal ? d - c : c - d;
    }

    const where: any = { accountId };
    if (from || to) {
      where.transactionDate = {
        ...(from && { gte: new Date(from) }),
        ...(to   && { lte: new Date(to) }),
      };
    }

    const [transactions, total] = await Promise.all([
      this.prisma.accountTransaction.findMany({
        where,
        orderBy: { transactionDate: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.accountTransaction.count({ where }),
    ]);

    // Compute running balance per row
    const isDebitNormal = account.type === AccountType.ASSET || account.type === AccountType.EXPENSE;
    let running = openingBalance;
    const rows = transactions.map(tx => {
      const d = Number(tx.debit), c = Number(tx.credit);
      running += isDebitNormal ? d - c : c - d;
      return { ...tx, debit: d, credit: c, runningBalance: running };
    });

    return {
      account: { ...account, balance: Number(account.balance) },
      openingBalance,
      rows,
      closingBalance: running,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INCOME STATEMENT  (Profit & Loss)
  // ─────────────────────────────────────────────────────────────────────────
  async getIncomeStatement(from?: string, to?: string) {
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { isGroup: false, isActive: true, type: { in: [AccountType.INCOME, AccountType.EXPENSE] } },
      select: { id: true, code: true, name: true, type: true, balance: true,
        parent: { select: { id: true, code: true, name: true } } },
      orderBy: { code: 'asc' },
    });

    const amounts = await this.resolveAmounts(accounts.map(a => a.id), from, to);

    const income: any[]  = [];
    const expense: any[] = [];
    let totalIncome = 0, totalExpense = 0;

    for (const a of accounts) {
      const { debit, credit } = amounts.get(a.id) ?? { debit: 0, credit: 0 };
      if (a.type === AccountType.INCOME) {
        const amount = credit - debit;   // income increases with credit
        totalIncome += amount;
        income.push({ ...a, amount });
      } else {
        const amount = debit - credit;   // expense increases with debit
        totalExpense += amount;
        expense.push({ ...a, amount });
      }
    }

    return {
      income,  totalIncome,
      expense, totalExpense,
      netProfit: totalIncome - totalExpense,
      from, to,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BALANCE SHEET
  // ─────────────────────────────────────────────────────────────────────────
  async getBalanceSheet(asOf?: string) {
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { isGroup: false, isActive: true,
        type: { in: [AccountType.ASSET, AccountType.LIABILITY, AccountType.EQUITY] } },
      select: { id: true, code: true, name: true, type: true, balance: true,
        parent: { select: { id: true, code: true, name: true } } },
      orderBy: { code: 'asc' },
    });

    // If asOf provided, compute balance up to that date from transactions
    let amounts: Map<string, { debit: number; credit: number }>;
    if (asOf) {
      amounts = await this.resolveAmounts(accounts.map(a => a.id), undefined, asOf);
    } else {
      amounts = new Map(accounts.map(a => ({ id: a.id, balance: Number(a.balance) }))
        .map(a => [a.id, { debit: 0, credit: 0 }]));
    }

    const assets: any[]      = [];
    const liabilities: any[] = [];
    const equity: any[]      = [];
    let totalAssets = 0, totalLiabilities = 0, totalEquity = 0;

    for (const a of accounts) {
      let amount: number;
      if (asOf) {
        const { debit, credit } = amounts.get(a.id) ?? { debit: 0, credit: 0 };
        amount = a.type === AccountType.ASSET ? debit - credit : credit - debit;
      } else {
        amount = Number(a.balance);
      }

      if (a.type === AccountType.ASSET)     { assets.push({ ...a, amount });      totalAssets      += amount; }
      if (a.type === AccountType.LIABILITY) { liabilities.push({ ...a, amount }); totalLiabilities += amount; }
      if (a.type === AccountType.EQUITY)    { equity.push({ ...a, amount });      totalEquity      += amount; }
    }

    return {
      assets,      totalAssets,
      liabilities, totalLiabilities,
      equity,      totalEquity,
      totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
      balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
      asOf,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ACCOUNT ACTIVITY SUMMARY  (dashboard-style)
  // ─────────────────────────────────────────────────────────────────────────
  async getAccountSummary(from?: string, to?: string) {
    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(from);
    if (to)   dateFilter.lte = new Date(to);

    const bySource = await this.prisma.accountTransaction.groupBy({
      by: ['sourceType'],
      where: Object.keys(dateFilter).length ? { transactionDate: dateFilter } : undefined,
      _sum: { debit: true, credit: true },
      _count: { id: true },
    });

    const byType = await this.prisma.accountTransaction.groupBy({
      by: ['accountId'],
      where: Object.keys(dateFilter).length ? { transactionDate: dateFilter } : undefined,
      _sum: { debit: true, credit: true },
    });

    // Enrich with account type
    const accountIds = byType.map(b => b.accountId);
    const accountTypes = await this.prisma.chartOfAccount.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, type: true },
    });
    const typeMap = new Map(accountTypes.map(a => [a.id, a.type]));

    const byAccountType: Record<string, { debit: number; credit: number }> = {};
    for (const b of byType) {
      const t = typeMap.get(b.accountId) ?? 'UNKNOWN';
      if (!byAccountType[t]) byAccountType[t] = { debit: 0, credit: 0 };
      byAccountType[t].debit  += Number(b._sum.debit  ?? 0);
      byAccountType[t].credit += Number(b._sum.credit ?? 0);
    }

    return {
      bySourceType: bySource.map(s => ({
        sourceType: s.sourceType,
        count:  s._count.id,
        debit:  Number(s._sum.debit  ?? 0),
        credit: Number(s._sum.credit ?? 0),
      })),
      byAccountType,
      from, to,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helper: resolve debit/credit totals for a list of accounts
  // Uses stored balance when no date range, otherwise aggregates transactions
  // ─────────────────────────────────────────────────────────────────────────
  private async resolveAmounts(
    accountIds: string[],
    from?: string,
    to?: string,
  ): Promise<Map<string, { debit: number; credit: number }>> {
    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(from);
    if (to)   dateFilter.lte = new Date(to);

    const agg = await this.prisma.accountTransaction.groupBy({
      by: ['accountId'],
      where: {
        accountId: { in: accountIds },
        ...(Object.keys(dateFilter).length ? { transactionDate: dateFilter } : {}),
      },
      _sum: { debit: true, credit: true },
    });

    return new Map(agg.map(a => [a.accountId, {
      debit:  Number(a._sum.debit  ?? 0),
      credit: Number(a._sum.credit ?? 0),
    }]));
  }
}
