import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountType } from '@prisma/client';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService,) {}

  // ─────────────────────────────────────────────────────────────────────────
  // TRIAL BALANCE (6-Column Format)
  // Returns opening balance, period transactions, and closing balance
  // ─────────────────────────────────────────────────────────────────────────
      async getTrialBalance(from?: string, to?: string, includeTagAccounts: boolean = false) {
    const allAccounts = await this.prisma.chartOfAccount.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, type: true, balance: true, isGroup: true, parentId: true },
      orderBy: { code: 'asc' },
    });

    const accountMap = new Map<string, any>(allAccounts.map(a => [a.id, { ...a, balance: Number(a.balance) }]));

    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;

    // 1. Get Opening Balances
    const openingWhere: any = fromDate ? {
      OR: [
        { sourceType: 'OPENING_BALANCE' },
        { transactionDate: { lt: fromDate }, sourceType: { not: 'OPENING_BALANCE' } }
      ]
    } : { sourceType: 'OPENING_BALANCE' };

    const openingAgg = await this.prisma.accountTransaction.groupBy({
      by: includeTagAccounts ? ['accountId', 'tagAccountId'] : ['accountId'],
      where: openingWhere,
      _sum: { debit: true, credit: true },
    });

    // 2. Get Period Transactions
    const txWhere: any = { sourceType: { not: 'OPENING_BALANCE' } };
    if (fromDate || toDate) {
      txWhere.transactionDate = {};
      if (fromDate) txWhere.transactionDate.gte = fromDate;
      if (toDate) txWhere.transactionDate.lte = toDate;
    }

    const txAgg = await this.prisma.accountTransaction.groupBy({
      by: includeTagAccounts ? ['accountId', 'tagAccountId'] : ['accountId'],
      where: txWhere,
      _sum: { debit: true, credit: true },
    });

    const getKey = (accId: string, tagId?: string | null) => includeTagAccounts && tagId ? `${accId}_${tagId}` : accId;
    const amountsMap = new Map<string, { openingDr: number, openingCr: number, txDr: number, txCr: number, accountId: string, tagAccountId: string | null }>();

    for (const o of openingAgg) {
      const k = getKey(o.accountId, (o as any).tagAccountId);
      if (!amountsMap.has(k)) amountsMap.set(k, { openingDr: 0, openingCr: 0, txDr: 0, txCr: 0, accountId: o.accountId, tagAccountId: (o as any).tagAccountId || null });
      const entry = amountsMap.get(k)!;
      entry.openingDr += Number(o._sum.debit ?? 0);
      entry.openingCr += Number(o._sum.credit ?? 0);
    }

    for (const t of txAgg) {
      const k = getKey(t.accountId, (t as any).tagAccountId);
      if (!amountsMap.has(k)) amountsMap.set(k, { openingDr: 0, openingCr: 0, txDr: 0, txCr: 0, accountId: t.accountId, tagAccountId: (t as any).tagAccountId || null });
      const entry = amountsMap.get(k)!;
      entry.txDr += Number(t._sum.debit ?? 0);
      entry.txCr += Number(t._sum.credit ?? 0);
    }
    
    // 3. Build data for leaf accounts and tag accounts
    const leafNodes: any[] = [];
    
    for (const [k, v] of amountsMap.entries()) {
      const acc = accountMap.get(v.accountId);
      if (!acc) continue;

      const openNet = v.openingDr - v.openingCr;
      const openingDebit = openNet > 0 ? openNet : 0;
      const openingCredit = openNet < 0 ? -openNet : 0;

      const closingNet = (v.openingDr + v.txDr) - (v.openingCr + v.txCr);
      const closingDebit = closingNet > 0 ? closingNet : 0;
      const closingCredit = closingNet < 0 ? -closingNet : 0;

      if (openingDebit === 0 && openingCredit === 0 && v.txDr === 0 && v.txCr === 0 && closingDebit === 0 && closingCredit === 0) {
        continue;
      }

      if (includeTagAccounts && v.tagAccountId) {
        // Find Tag Name from ChartOfAccount if exists, or Payee tables if needed.
        // Wait, if tag is in ChartOfAccount:
        const tagAcc = accountMap.get(v.tagAccountId);
        
        leafNodes.push({
          id: k,
          isTagAccount: true,
          parentId: acc.id,
          code: tagAcc ? tagAcc.code : v.tagAccountId,
          name: tagAcc ? tagAcc.name : `Tag: ${v.tagAccountId}`,
          type: acc.type,
          openingDebit, openingCredit,
          transactionDebit: v.txDr, transactionCredit: v.txCr,
          closingDebit, closingCredit,
        });
      } else {
        leafNodes.push({
          ...acc,
          openingDebit, openingCredit,
          transactionDebit: v.txDr, transactionCredit: v.txCr,
          closingDebit, closingCredit,
        });
      }
    }

    // 4. Roll up to parent groups
    const nodeMap = new Map<string, any>();
    for (const node of leafNodes) {
      nodeMap.set(node.id, node);
    }
    
    for (const acc of allAccounts) {
      if (acc.isGroup && !nodeMap.has(acc.id)) {
        nodeMap.set(acc.id, {
          ...acc,
          openingDebit: 0, openingCredit: 0,
          transactionDebit: 0, transactionCredit: 0,
          closingDebit: 0, closingCredit: 0,
        });
      }
    }

    const childMap = new Map<string, any[]>();
    for (const node of nodeMap.values()) {
      if (node.parentId) {
        if (!childMap.has(node.parentId)) childMap.set(node.parentId, []);
        childMap.get(node.parentId)!.push(node);
      }
    }

    const rollUp = (nodeId: string) => {
      const node = nodeMap.get(nodeId);
      if (!node) return;
      
      const children = childMap.get(nodeId) || [];
      
      // If this node has children, ignore its own directly posted balances to prevent double counting
      if (children.length > 0) {
        node.openingDebit = 0;
        node.openingCredit = 0;
        node.transactionDebit = 0;
        node.transactionCredit = 0;
        node.closingDebit = 0;
        node.closingCredit = 0;
      }

      for (const child of children) {
        rollUp(child.id);
        
        // Always roll up! This fixes the issue where leaf accounts did not roll up tag accounts
        node.openingDebit += child.openingDebit || 0;
        node.openingCredit += child.openingCredit || 0;
        node.transactionDebit += child.transactionDebit || 0;
        node.transactionCredit += child.transactionCredit || 0;
        node.closingDebit += child.closingDebit || 0;
        node.closingCredit += child.closingCredit || 0;
      }

      // After adding all children, recalculate net for THIS node
      const openNet = node.openingDebit - node.openingCredit;
      node.openingDebit = openNet > 0 ? openNet : 0;
      node.openingCredit = openNet < 0 ? -openNet : 0;
      
      // We do NOT net Transactions! Transactions should show total Dr and total Cr volume.
      
      const closeNet = node.closingDebit - node.closingCredit;
      node.closingDebit = closeNet > 0 ? closeNet : 0;
      node.closingCredit = closeNet < 0 ? -closeNet : 0;
    };

    // Find root nodes and roll up
    for (const node of nodeMap.values()) {
      if (!node.parentId) {
        rollUp(node.id);
      }
    }

    // 5. Calculate Grand Totals from Root Nodes ONLY
    let totalOpeningDebit = 0, totalOpeningCredit = 0;
    let totalTxDebit = 0, totalTxCredit = 0;
    let totalClosingDebit = 0, totalClosingCredit = 0;

    const roots = Array.from(nodeMap.values()).filter(n => !n.parentId && !n.isTagAccount);
    for (const root of roots) {
      totalOpeningDebit += root.openingDebit;
      totalOpeningCredit += root.openingCredit;
      totalTxDebit += root.transactionDebit;
      totalTxCredit += root.transactionCredit;
      totalClosingDebit += root.closingDebit;
      totalClosingCredit += root.closingCredit;
    }

    // 6. Flatten tree
    const rows: any[] = [];
    const traverse = (nodeId: string, level = 0) => {
      const node = nodeMap.get(nodeId);
      if (!node) return;
      
      if (node.openingDebit !== 0 || node.openingCredit !== 0 || node.transactionDebit !== 0 || node.transactionCredit !== 0 || node.closingDebit !== 0 || node.closingCredit !== 0) {
        rows.push({ ...node, level });
      }
      
      const children = childMap.get(nodeId) || [];
      children.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
      for (const child of children) {
        traverse(child.id, level + 1);
      }
    };

    roots.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    for (const root of roots) {
      traverse(root.id, 0);
    }

    return { 
      rows, 
      totalDebit: totalClosingDebit, 
      totalCredit: totalClosingCredit,
      totalOpeningDebit,
      totalOpeningCredit,
      totalTransactionDebit: totalTxDebit,
      totalTransactionCredit: totalTxCredit,
      totalClosingDebit,
      totalClosingCredit,
      balanced: Math.abs(totalClosingDebit - totalClosingCredit) < 0.01, 
      from, 
      to 
    };
  }
  async getGeneralLedger(
    accountId: string,
    from?: string,
    to?: string,
    page = 1,
    limit = 50,
    sourceType?: string,
  ) {
    const account = await this.prisma.chartOfAccount.findUnique({
      where: { id: accountId },
      select: { id: true, code: true, name: true, type: true, balance: true },
    });
    if (!account) throw new NotFoundException('Account not found');

    const isDebitNormal = account.type === AccountType.ASSET || account.type === AccountType.EXPENSE;

    // Opening balance = sum of all transactions BEFORE `from` matching optional filters
    const openingWhere: any = { accountId };
    if (from) {
      openingWhere.transactionDate = { lt: new Date(from) };
    }
    if (sourceType) {
      openingWhere.sourceType = sourceType;
    }

    let openingBalance = 0;
    if (from || sourceType) {
      const before = await this.prisma.accountTransaction.aggregate({
        where: openingWhere,
        _sum: { debit: true, credit: true },
      });
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
    if (sourceType) {
      where.sourceType = sourceType;
    }

    // Stable sort order: transactionDate, then createdAt, then id to prevent row shifting
    const orderBy = [
      { transactionDate: 'asc' as const },
      { createdAt: 'asc' as const },
      { id: 'asc' as const }
    ];

    const [transactions, total, totalAgg] = await Promise.all([
      this.prisma.accountTransaction.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.accountTransaction.count({ where }),
      this.prisma.accountTransaction.aggregate({
        where,
        _sum: { debit: true, credit: true },
      }),
    ]);

    // Calculate starting balance for this specific page by summing transactions skipped
    let pageStartingBalance = openingBalance;
    if (page > 1) {
      const skippedTx = await this.prisma.accountTransaction.findMany({
        where,
        orderBy,
        skip: 0,
        take: (page - 1) * limit,
        select: { debit: true, credit: true },
      });
      for (const tx of skippedTx) {
        const d = Number(tx.debit), c = Number(tx.credit);
        pageStartingBalance += isDebitNormal ? d - c : c - d;
      }
    }

    // Compute running balance per row on current page
    let running = pageStartingBalance;
    const rows = transactions.map(tx => {
      const d = Number(tx.debit), c = Number(tx.credit);
      running += isDebitNormal ? d - c : c - d;
      return {
        ...tx,
        debit: d,
        credit: c,
        runningBalance: running,
      };
    });

    const rangeTotalDebit = Number(totalAgg._sum.debit ?? 0);
    const rangeTotalCredit = Number(totalAgg._sum.credit ?? 0);
    const rangeClosingBalance = isDebitNormal
      ? openingBalance + rangeTotalDebit - rangeTotalCredit
      : openingBalance + rangeTotalCredit - rangeTotalDebit;

    return {
      account: { ...account, balance: Number(account.balance) },
      openingBalance,
      rows,
      closingBalance: running,
      rangeTotalDebit,
      rangeTotalCredit,
      rangeClosingBalance,
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
