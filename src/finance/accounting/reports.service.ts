import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountType } from '@prisma/client';

function parseFromDate(dateStr?: string): Date | undefined {
  if (!dateStr) return undefined;
  if (dateStr.includes('T')) {
    return new Date(dateStr);
  }
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function parseToDate(dateStr?: string): Date | undefined {
  if (!dateStr) return undefined;
  if (dateStr.includes('T')) {
    return new Date(dateStr);
  }
  return new Date(`${dateStr}T23:59:59.999Z`);
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // TRIAL BALANCE (6-Column Format)
  // Returns opening balance, period transactions, and closing balance
  // ─────────────────────────────────────────────────────────────────────────
  async getTrialBalance(
    from?: string,
    to?: string,
    includeTagAccounts: boolean = false,
  ) {
    const allAccounts = await this.prisma.chartOfAccount.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        balance: true,
        isGroup: true,
        parentId: true,
      },
      orderBy: { code: 'asc' },
    });

    const accountMap = new Map<string, any>(
      allAccounts.map((a) => [a.id, { ...a, balance: Number(a.balance) }]),
    );

    const fromDate = parseFromDate(from);
    const toDate = parseToDate(to);

    // ─── 1 & 2. Aggregate amounts, keyed by EFFECTIVE account ────────────────
    // The effective account is: tagAccountId when set (the real sub-account /
    // leaf where the balance lives), otherwise accountId. This is essential
    // because in this system ALL postings go through tagAccountId, so grouping
    // by accountId alone would land amounts on group/parent accounts and then
    // lose them during rollup zeroing.
    const openingWhere: any = fromDate
      ? {
          OR: [
            { sourceType: 'OPENING_BALANCE' },
            {
              transactionDate: { lt: fromDate },
              sourceType: { not: 'OPENING_BALANCE' },
            },
          ],
        }
      : { sourceType: 'OPENING_BALANCE' };

    const txWhere: any = { sourceType: { not: 'OPENING_BALANCE' } };
    if (fromDate || toDate) {
      txWhere.transactionDate = {};
      if (fromDate) txWhere.transactionDate.gte = fromDate;
      if (toDate) txWhere.transactionDate.lte = toDate;
    }

    // Fetch raw opening rows grouped by (accountId, tagAccountId)
    const openingRaw = await this.prisma.accountTransaction.groupBy({
      by: ['accountId', 'tagAccountId'],
      where: openingWhere,
      _sum: { debit: true, credit: true },
    });

    // Fetch raw period-transaction rows grouped by (accountId, tagAccountId)
    const txRaw = await this.prisma.accountTransaction.groupBy({
      by: ['accountId', 'tagAccountId'],
      where: txWhere,
      _sum: { debit: true, credit: true },
    });

    // Build canonical amounts map:
    //   key = tagAccountId if present, else accountId  (effective posting account)
    const amountsMap = new Map<
      string,
      { openingDr: number; openingCr: number; txDr: number; txCr: number }
    >();

    const effectiveId = (row: { accountId: string; tagAccountId?: string | null }) =>
      (row as any).tagAccountId || row.accountId;

    for (const o of openingRaw) {
      const eid = effectiveId(o as any);
      if (!amountsMap.has(eid))
        amountsMap.set(eid, { openingDr: 0, openingCr: 0, txDr: 0, txCr: 0 });
      const entry = amountsMap.get(eid)!;
      entry.openingDr += Number(o._sum.debit ?? 0);
      entry.openingCr += Number(o._sum.credit ?? 0);
    }

    for (const t of txRaw) {
      const eid = effectiveId(t as any);
      if (!amountsMap.has(eid))
        amountsMap.set(eid, { openingDr: 0, openingCr: 0, txDr: 0, txCr: 0 });
      const entry = amountsMap.get(eid)!;
      entry.txDr += Number(t._sum.debit ?? 0);
      entry.txCr += Number(t._sum.credit ?? 0);
    }

    // ─── 3. Build tag display breakdown from the same raw rows ───────────────
    // No extra DB queries needed — openingRaw / txRaw are already (accountId, tagAccountId).
    // tagBreakdownMap is keyed by accountId and lists each tagAccountId sub-breakdown.
    // This is purely for display rows — it does NOT affect any balance calculations.
    const tagBreakdownMap = new Map<
      string, // accountId (the parent account)
      Map<string, { openingDr: number; openingCr: number; txDr: number; txCr: number }>
    >();

    if (includeTagAccounts) {
      const upsertTag = (accountId: string, tagId: string) => {
        if (!tagBreakdownMap.has(accountId))
          tagBreakdownMap.set(accountId, new Map());
        const inner = tagBreakdownMap.get(accountId)!;
        if (!inner.has(tagId))
          inner.set(tagId, { openingDr: 0, openingCr: 0, txDr: 0, txCr: 0 });
        return inner.get(tagId)!;
      };

      for (const o of openingRaw) {
        const tagId = (o as any).tagAccountId as string | null;
        if (!tagId) continue;
        const e = upsertTag(o.accountId, tagId);
        e.openingDr += Number(o._sum.debit ?? 0);
        e.openingCr += Number(o._sum.credit ?? 0);
      }

      for (const t of txRaw) {
        const tagId = (t as any).tagAccountId as string | null;
        if (!tagId) continue;
        const e = upsertTag(t.accountId, tagId);
        e.txDr += Number(t._sum.debit ?? 0);
        e.txCr += Number(t._sum.credit ?? 0);
      }
    }


    // ─── 4. Build leaf nodes from canonical amountsMap ────────────────────────
    const leafNodes: any[] = [];

    for (const [accountId, v] of amountsMap.entries()) {
      const acc = accountMap.get(accountId);
      if (!acc) continue;

      const openNet = v.openingDr - v.openingCr;
      const openingDebit = openNet > 0 ? openNet : 0;
      const openingCredit = openNet < 0 ? -openNet : 0;

      const closingNet = v.openingDr + v.txDr - (v.openingCr + v.txCr);
      const closingDebit = closingNet > 0 ? closingNet : 0;
      const closingCredit = closingNet < 0 ? -closingNet : 0;

      if (
        openingDebit === 0 &&
        openingCredit === 0 &&
        v.txDr === 0 &&
        v.txCr === 0 &&
        closingDebit === 0 &&
        closingCredit === 0
      ) {
        continue;
      }

      // Push the account leaf node with correct balances
      leafNodes.push({
        ...acc,
        openingDebit,
        openingCredit,
        transactionDebit: v.txDr,
        transactionCredit: v.txCr,
        closingDebit,
        closingCredit,
        // Attach tag breakdown only if requested — used later in traverse for display rows.
        // Convert inner Map<tagId, amounts> → array of {tagAccountId, ...} for easy iteration.
        _tagBreakdown: includeTagAccounts
          ? Array.from(
              (tagBreakdownMap.get(accountId) ?? new Map()).entries(),
              ([tagAccountId, amounts]) => ({ tagAccountId, ...amounts }),
            )
          : [],
      });
    }

    // ─── 5. Roll up to parent groups ──────────────────────────────────────────
    const nodeMap = new Map<string, any>();
    for (const node of leafNodes) {
      nodeMap.set(node.id, node);
    }

    for (const acc of allAccounts) {
      if (acc.isGroup && !nodeMap.has(acc.id)) {
        nodeMap.set(acc.id, {
          ...acc,
          openingDebit: 0,
          openingCredit: 0,
          transactionDebit: 0,
          transactionCredit: 0,
          closingDebit: 0,
          closingCredit: 0,
          _tagBreakdown: [],
        });
      }
    }

    // Ensure all ancestors of active nodes are in nodeMap to prevent orphaned trees
    const ensureAncestors = (nodeId: string) => {
      const node = accountMap.get(nodeId);
      if (!node) return;
      if (!nodeMap.has(nodeId)) {
        nodeMap.set(nodeId, {
          ...node,
          openingDebit: 0,
          openingCredit: 0,
          transactionDebit: 0,
          transactionCredit: 0,
          closingDebit: 0,
          closingCredit: 0,
          _tagBreakdown: [],
        });
      }
      if (node.parentId) {
        ensureAncestors(node.parentId);
      }
    };

    for (const nodeId of Array.from(nodeMap.keys())) {
      const node = nodeMap.get(nodeId);
      if (node?.parentId) {
        ensureAncestors(node.parentId);
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

    // ─── 6. Calculate Grand Totals from Root Nodes ONLY ──────────────────────
    let totalOpeningDebit = 0,
      totalOpeningCredit = 0;
    let totalTxDebit = 0,
      totalTxCredit = 0;
    let totalClosingDebit = 0,
      totalClosingCredit = 0;

    const roots = Array.from(nodeMap.values()).filter((n) => !n.parentId);
    for (const root of roots) {
      totalOpeningDebit += root.openingDebit;
      totalOpeningCredit += root.openingCredit;
      totalTxDebit += root.transactionDebit;
      totalTxCredit += root.transactionCredit;
      totalClosingDebit += root.closingDebit;
      totalClosingCredit += root.closingCredit;
    }

    // ─── 7. Flatten tree, injecting tag sub-rows for display only ─────────────
    const rows: any[] = [];
    const traverse = (nodeId: string, level = 0) => {
      const node = nodeMap.get(nodeId);
      if (!node) return;

      if (
        node.openingDebit !== 0 ||
        node.openingCredit !== 0 ||
        node.transactionDebit !== 0 ||
        node.transactionCredit !== 0 ||
        node.closingDebit !== 0 ||
        node.closingCredit !== 0
      ) {
        // If includeTagAccounts is false, skip pushing sub-accounts (level >= 4) to rows.
        if (includeTagAccounts || level < 4) {
          const rowToPush = { ...node, level };
          if (level >= 4) {
            rowToPush.isTagAccount = true;
          }
          rows.push(rowToPush);
        }

        // If this is a leaf account (non-group) with tag breakdown, insert tag sub-rows.
        // These rows are display-only and do NOT affect any totals or rollup logic.
        if (!node.isGroup && node._tagBreakdown?.length > 0) {
          const tags: Array<{
            tagAccountId: string;
            openingDr: number;
            openingCr: number;
            txDr: number;
            txCr: number;
          }> = node._tagBreakdown;
          tags.sort((a, b) => {
            const ta = accountMap.get(a.tagAccountId);
            const tb = accountMap.get(b.tagAccountId);
            return (ta?.code ?? '').localeCompare(tb?.code ?? '');
          });

          for (const tag of tags) {
            const tagAcc = accountMap.get(tag.tagAccountId);

            const openNet = tag.openingDr - tag.openingCr;
            const openingDebit = openNet > 0 ? openNet : 0;
            const openingCredit = openNet < 0 ? -openNet : 0;

            const closeNet =
              tag.openingDr + tag.txDr - (tag.openingCr + tag.txCr);
            const closingDebit = closeNet > 0 ? closeNet : 0;
            const closingCredit = closeNet < 0 ? -closeNet : 0;

            // Skip zero tag rows
            if (
              openingDebit === 0 &&
              openingCredit === 0 &&
              tag.txDr === 0 &&
              tag.txCr === 0 &&
              closingDebit === 0 &&
              closingCredit === 0
            )
              continue;

            rows.push({
              id: `${node.id}_${tag.tagAccountId}`,
              isTagAccount: true,
              parentId: node.id,
              code: tagAcc ? tagAcc.code : tag.tagAccountId,
              name: tagAcc ? tagAcc.name : `Tag: ${tag.tagAccountId}`,
              type: node.type,
              level: level + 1,
              openingDebit,
              openingCredit,
              transactionDebit: tag.txDr,
              transactionCredit: tag.txCr,
              closingDebit,
              closingCredit,
            });
          }
        }
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
      to,
    };
  }
  
  async getGeneralLedger(
    accountId: string,
    from?: string,
    to?: string,
    page = 1,
    limit = 50,
    sourceType?: string,
    sortBy?: string,
    sortOrder?: 'asc' | 'desc',
  ) {
    const accountIds = accountId
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, code: true, name: true, type: true, balance: true },
    });
    if (accounts.length === 0) throw new NotFoundException('Account not found');

    const fromDate = parseFromDate(from);
    const toDate = parseToDate(to);

    const dir = sortOrder === 'desc' ? ('desc' as const) : ('asc' as const);
    let orderBy: any = [
      { transactionDate: dir },
      { createdAt: dir },
      { id: dir },
    ];

    if (sortBy === 'sourceRef') {
      orderBy = [{ sourceRef: dir }, { transactionDate: 'asc' as const }, { id: 'asc' as const }];
    } else if (sortBy === 'sourceType') {
      orderBy = [{ sourceType: dir }, { transactionDate: 'asc' as const }, { id: 'asc' as const }];
    } else if (sortBy === 'debit') {
      orderBy = [{ debit: dir }, { transactionDate: 'asc' as const }, { id: 'asc' as const }];
    } else if (sortBy === 'credit') {
      orderBy = [{ credit: dir }, { transactionDate: 'asc' as const }, { id: 'asc' as const }];
    }

    // Process each account independently so multi-selected sub-accounts get separate ledgers
    const ledgers = await Promise.all(
      accounts.map(async (acc) => {
        const accountMatch = {
          OR: [
            { accountId: acc.id },
            { tagAccountId: acc.id },
          ],
        };

        const openingWhere: any = { AND: [accountMatch] };
        if (sourceType) {
          openingWhere.AND.push({ sourceType });
          if (fromDate) openingWhere.AND.push({ transactionDate: { lt: fromDate } });
        } else {
          openingWhere.AND.push({
            OR: [
              { sourceType: 'OPENING_BALANCE' },
              ...(fromDate
                ? [
                    {
                      transactionDate: { lt: fromDate },
                      sourceType: { not: 'OPENING_BALANCE' },
                    },
                  ]
                : []),
            ],
          });
        }

        const before = await this.prisma.accountTransaction.aggregate({
          where: openingWhere,
          _sum: { debit: true, credit: true },
        });
        const d = Number(before._sum.debit ?? 0);
        const c = Number(before._sum.credit ?? 0);
        const openingBalance = d - c;

        const where: any = { AND: [accountMatch] };
        if (sourceType) where.AND.push({ sourceType });
        else where.AND.push({ sourceType: { not: 'OPENING_BALANCE' } });

        if (fromDate || toDate) {
          const dateConditions: any = {};
          if (fromDate) dateConditions.gte = fromDate;
          if (toDate) dateConditions.lte = toDate;
          where.AND.push({ transactionDate: dateConditions });
        }

        const [transactions, total, totalAgg] = await Promise.all([
          this.prisma.accountTransaction.findMany({
            where,
            orderBy,
            skip: (page - 1) * limit,
            take: limit,
            include: {
              tagAccount: {
                select: { id: true, code: true, name: true, type: true },
              },
            },
          }),
          this.prisma.accountTransaction.count({ where }),
          this.prisma.accountTransaction.aggregate({
            where,
            _sum: { debit: true, credit: true },
          }),
        ]);

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
            pageStartingBalance += Number(tx.debit) - Number(tx.credit);
          }
        }

        const pvIds = transactions
          .filter((tx) => tx.sourceType === 'PAYMENT_VOUCHER')
          .map((tx) => tx.sourceId);
        const rvIds = transactions
          .filter((tx) => tx.sourceType === 'RECEIPT_VOUCHER')
          .map((tx) => tx.sourceId);

        const [pvs, rvs] = await Promise.all([
          this.prisma.paymentVoucher.findMany({
            where: { id: { in: pvIds } },
            select: { id: true, chequeNo: true },
          }),
          this.prisma.receiptVoucher.findMany({
            where: { id: { in: rvIds } },
            select: { id: true, chequeNo: true },
          }),
        ]);

        const chequeMap = new Map<string, string>();
        pvs.forEach((pv) => {
          if (pv.chequeNo) chequeMap.set(pv.id, pv.chequeNo);
        });
        rvs.forEach((rv) => {
          if (rv.chequeNo) chequeMap.set(rv.id, rv.chequeNo);
        });

        let running = pageStartingBalance;
        const rows = transactions.map((tx) => {
          const deb = Number(tx.debit);
          const cred = Number(tx.credit);
          running += deb - cred;
          return {
            ...tx,
            debit: deb,
            credit: cred,
            runningBalance: running,
            chequeNo: chequeMap.get(tx.sourceId) || '',
          };
        });

        const rangeTotalDebit = Number(totalAgg._sum.debit ?? 0);
        const rangeTotalCredit = Number(totalAgg._sum.credit ?? 0);
        const rangeClosingBalance =
          openingBalance + rangeTotalDebit - rangeTotalCredit;

        return {
          account: { ...acc, balance: Number(acc.balance) },
          openingBalance,
          rows,
          closingBalance: running,
          rangeTotalDebit,
          rangeTotalCredit,
          rangeClosingBalance,
          pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };
      }),
    );

    const primaryLedger = ledgers[0];
    const combinedAccount =
      accounts.length === 1
        ? primaryLedger.account
        : {
            id: accountId,
            code: accounts.map((a) => a.code).join(', '),
            name: `${accounts.length} Selected Sub-Accounts`,
            type: accounts[0].type,
            balance: accounts.reduce((sum, a) => sum + Number(a.balance), 0),
          };

    return {
      account: combinedAccount,
      openingBalance: ledgers.reduce((sum, l) => sum + l.openingBalance, 0),
      rows: primaryLedger.rows,
      closingBalance: primaryLedger.closingBalance,
      rangeTotalDebit: ledgers.reduce((sum, l) => sum + l.rangeTotalDebit, 0),
      rangeTotalCredit: ledgers.reduce((sum, l) => sum + l.rangeTotalCredit, 0),
      rangeClosingBalance: ledgers.reduce((sum, l) => sum + l.rangeClosingBalance, 0),
      pagination: primaryLedger.pagination,
      ledgers,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INCOME STATEMENT  (Profit & Loss)
  // ─────────────────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────
  // INCOME STATEMENT  (Profit & Loss — Market-Standard Hierarchical & Tag-Aware)
  // ─────────────────────────────────────────────────────────────────────────
  async getIncomeStatement(
    params?: string | {
      from?: string;
      to?: string;
      compareFrom?: string;
      compareTo?: string;
      includeTagAccounts?: boolean;
      showZeroBalances?: boolean;
    },
    toParam?: string,
  ) {
    const opts = typeof params === 'object' ? params : { from: params, to: toParam };
    const fromStr = opts.from;
    const toStr = opts.to;
    const compareFromStr = opts.compareFrom;
    const compareToStr = opts.compareTo;
    const includeTagAccounts = opts.includeTagAccounts ?? true;
    const showZeroBalances = opts.showZeroBalances ?? false;

    const fromDate = parseToDate(fromStr);
    const toDate = parseToDate(toStr);
    const compareFromDate = parseToDate(compareFromStr);
    const compareToDate = parseToDate(compareToStr);

    // 1. Fetch all INCOME and EXPENSE Chart of Accounts
    const allAccounts = await this.prisma.chartOfAccount.findMany({
      where: {
        isActive: true,
        type: { in: [AccountType.INCOME, AccountType.EXPENSE] },
      },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        balance: true,
        isGroup: true,
        isTagAccount: true,
        parentId: true,
      },
      orderBy: { code: 'asc' },
    });

    const accountMap = new Map<string, any>(
      allAccounts.map((a) => [a.id, { ...a, balance: Number(a.balance) }]),
    );

    // 2. Fetch transaction sums for primary period
    const wherePrimary: any = {};
    if (fromDate || toDate) {
      wherePrimary.transactionDate = {};
      if (fromDate) wherePrimary.transactionDate.gte = fromDate;
      if (toDate) wherePrimary.transactionDate.lte = toDate;
    }

    const primaryRaw = await this.prisma.accountTransaction.groupBy({
      by: ['accountId', 'tagAccountId'],
      where: wherePrimary,
      _sum: { debit: true, credit: true },
    });

    // 3. Fetch transaction sums for comparison period if requested
    let compareRaw: any[] = [];
    if (compareFromDate || compareToDate) {
      const whereCompare: any = {};
      whereCompare.transactionDate = {};
      if (compareFromDate) whereCompare.transactionDate.gte = compareFromDate;
      if (compareToDate) whereCompare.transactionDate.lte = compareToDate;

      compareRaw = await (this.prisma.accountTransaction.groupBy as any)({
        by: ['accountId', 'tagAccountId'],
        where: whereCompare,
        _sum: { debit: true, credit: true },
      });
    }

    // Determine target account ID for leaf attribution:
    // If tagAccountId is specified and exists in COA, attribute to tagAccountId (Level 3/4 sub-account), else accountId.
    const getLeafId = (row: { accountId: string; tagAccountId?: string | null }) => {
      if (row.tagAccountId && accountMap.has(row.tagAccountId)) {
        return row.tagAccountId;
      }
      return row.accountId;
    };

    // Amounts Map for Primary Period
    const amountsMap = new Map<string, { debit: number; credit: number }>();
    for (const r of primaryRaw) {
      const targetId = getLeafId(r as any);
      if (!amountsMap.has(targetId)) amountsMap.set(targetId, { debit: 0, credit: 0 });
      const entry = amountsMap.get(targetId)!;
      entry.debit += Number(r._sum.debit ?? 0);
      entry.credit += Number(r._sum.credit ?? 0);
    }

    // Amounts Map for Comparison Period
    const compareMap = new Map<string, { debit: number; credit: number }>();
    for (const r of compareRaw) {
      const targetId = getLeafId(r as any);
      if (!compareMap.has(targetId)) compareMap.set(targetId, { debit: 0, credit: 0 });
      const entry = compareMap.get(targetId)!;
      entry.debit += Number(r._sum.debit ?? 0);
      entry.credit += Number(r._sum.credit ?? 0);
    }

    // 4. Tag breakdown map
    const tagBreakdownMap = new Map<
      string, // accountId
      Map<string, { primaryDebit: number; primaryCredit: number; compareDebit: number; compareCredit: number }>
    >();

    if (includeTagAccounts) {
      const upsertTag = (accountId: string, tagId: string) => {
        if (!tagBreakdownMap.has(accountId)) tagBreakdownMap.set(accountId, new Map());
        const inner = tagBreakdownMap.get(accountId)!;
        if (!inner.has(tagId)) inner.set(tagId, { primaryDebit: 0, primaryCredit: 0, compareDebit: 0, compareCredit: 0 });
        return inner.get(tagId)!;
      };

      for (const r of primaryRaw) {
        const tagId = (r as any).tagAccountId as string | null;
        if (tagId && tagId !== r.accountId && accountMap.has(tagId)) {
          const e = upsertTag(r.accountId, tagId);
          e.primaryDebit += Number(r._sum.debit ?? 0);
          e.primaryCredit += Number(r._sum.credit ?? 0);
        }
      }

      for (const r of compareRaw) {
        const tagId = (r as any).tagAccountId as string | null;
        if (tagId && tagId !== r.accountId && accountMap.has(tagId)) {
          const e = upsertTag(r.accountId, tagId);
          e.compareDebit += Number(r._sum.debit ?? 0);
          e.compareCredit += Number(r._sum.credit ?? 0);
        }
      }
    }

    // Helper for net calculation based on account type
    const calcNet = (type: AccountType, debit: number, credit: number) => {
      return type === AccountType.INCOME ? credit - debit : debit - credit;
    };

    // 5. Build node map
    const nodeMap = new Map<string, any>();

    for (const acc of allAccounts) {
      const vPri = amountsMap.get(acc.id) ?? { debit: 0, credit: 0 };
      const vComp = compareMap.get(acc.id) ?? { debit: 0, credit: 0 };

      let amtPri = calcNet(acc.type as AccountType, vPri.debit, vPri.credit);
      let amtComp = calcNet(acc.type as AccountType, vComp.debit, vComp.credit);

      // If no date range specified and 0 transactions, fallback to stored balance
      if (!fromStr && !toStr && vPri.debit === 0 && vPri.credit === 0) {
        amtPri = Number(acc.balance);
      }

      const tags = Array.from(
        (tagBreakdownMap.get(acc.id) ?? new Map()).entries(),
        ([tagAccountId, val]) => ({
          tagAccountId,
          amount: calcNet(acc.type as AccountType, val.primaryDebit, val.primaryCredit),
          compareAmount: calcNet(acc.type as AccountType, val.compareDebit, val.compareCredit),
        }),
      );

      nodeMap.set(acc.id, {
        ...acc,
        amount: amtPri,
        compareAmount: amtComp,
        _tagBreakdown: tags,
      });
    }

    // Ensure all parent group nodes exist in nodeMap
    const ensureAncestors = (nodeId: string) => {
      const acc = accountMap.get(nodeId);
      if (!acc) return;
      if (!nodeMap.has(nodeId)) {
        nodeMap.set(nodeId, {
          ...acc,
          amount: 0,
          compareAmount: 0,
          _tagBreakdown: [],
        });
      }
      if (acc.parentId) ensureAncestors(acc.parentId);
    };

    for (const nodeId of Array.from(nodeMap.keys())) {
      const node = nodeMap.get(nodeId);
      if (node?.parentId) ensureAncestors(node.parentId);
    }

    const childMap = new Map<string, any[]>();
    for (const node of nodeMap.values()) {
      if (node.parentId) {
        if (!childMap.has(node.parentId)) childMap.set(node.parentId, []);
        childMap.get(node.parentId)!.push(node);
      }
    }

    // Rollup group account totals recursively
    const rollUp = (nodeId: string) => {
      const node = nodeMap.get(nodeId);
      if (!node) return;

      const children = childMap.get(nodeId) || [];
      if (children.length > 0) {
        node.amount = 0;
        node.compareAmount = 0;
      }

      for (const child of children) {
        rollUp(child.id);
        node.amount += child.amount || 0;
        node.compareAmount += child.compareAmount || 0;
      }
    };

    const roots = Array.from(nodeMap.values()).filter((n) => !n.parentId);
    for (const root of roots) {
      rollUp(root.id);
    }

    // 6. Flatten tree for Income & Expense sections
    const flattenTree = (type: AccountType) => {
      const typeRoots = roots.filter((r) => r.type === type);
      typeRoots.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
      const list: any[] = [];

      const traverse = (nodeId: string, level = 0) => {
        const node = nodeMap.get(nodeId);
        if (!node) return;

        const variance = node.amount - (node.compareAmount || 0);
        const percentageChange =
          node.compareAmount && node.compareAmount !== 0
            ? (variance / Math.abs(node.compareAmount)) * 100
            : 0;

        const rowObj = {
          id: node.id,
          code: node.code,
          name: node.name,
          type: node.type,
          isGroup: node.isGroup ?? false,
          isTagAccount: node.isTagAccount ?? false,
          parentId: node.parentId,
          level,
          amount: node.amount,
          compareAmount: node.compareAmount || 0,
          variance,
          percentageChange,
          parent: node.parentId ? accountMap.get(node.parentId) : null,
        };

        if (showZeroBalances || Math.abs(node.amount) > 0.001 || Math.abs(node.compareAmount || 0) > 0.001) {
          list.push(rowObj);
        }

        // Sub-ledger tag account sub-rows (excluding self-referencing tag IDs and accounts already in childMap)
        const childIds = new Set((childMap.get(nodeId) || []).map((c) => c.id));
        if (!node.isGroup && includeTagAccounts && node._tagBreakdown?.length > 0) {
          const tags: Array<{ tagAccountId: string; amount: number; compareAmount: number }> =
            node._tagBreakdown.filter(
              (t: any) => t.tagAccountId !== node.id && !childIds.has(t.tagAccountId),
            );
          tags.sort((a, b) => {
            const ta = accountMap.get(a.tagAccountId);
            const tb = accountMap.get(b.tagAccountId);
            return (ta?.code ?? '').localeCompare(tb?.code ?? '');
          });

          for (const tag of tags) {
            const tagAcc = accountMap.get(tag.tagAccountId);
            const tagVar = tag.amount - tag.compareAmount;
            const tagPct = tag.compareAmount !== 0 ? (tagVar / Math.abs(tag.compareAmount)) * 100 : 0;

            if (showZeroBalances || Math.abs(tag.amount) > 0.001 || Math.abs(tag.compareAmount) > 0.001) {
              list.push({
                id: `${node.id}_${tag.tagAccountId}`,
                code: tagAcc ? tagAcc.code : tag.tagAccountId,
                name: tagAcc ? tagAcc.name : `Tag: ${tag.tagAccountId}`,
                type: node.type,
                isGroup: false,
                isTagAccount: true,
                parentId: node.id,
                level: level + 1,
                amount: tag.amount,
                compareAmount: tag.compareAmount,
                variance: tagVar,
                percentageChange: tagPct,
                parent: { id: node.id, code: node.code, name: node.name },
              });
            }
          }
        }

        const children = childMap.get(nodeId) || [];
        children.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
        for (const child of children) {
          traverse(child.id, level + 1);
        }
      };

      for (const root of typeRoots) {
        traverse(root.id, 0);
      }

      return list;
    };

    const income = flattenTree(AccountType.INCOME);
    const expense = flattenTree(AccountType.EXPENSE);

    // Sum top-level root totals for total Income and total Expense
    const totalIncome = roots
      .filter((r) => r.type === AccountType.INCOME)
      .reduce((acc, r) => acc + (r.amount || 0), 0);
    const compareTotalIncome = roots
      .filter((r) => r.type === AccountType.INCOME)
      .reduce((acc, r) => acc + (r.compareAmount || 0), 0);

    const totalExpense = roots
      .filter((r) => r.type === AccountType.EXPENSE)
      .reduce((acc, r) => acc + (r.amount || 0), 0);
    const compareTotalExpense = roots
      .filter((r) => r.type === AccountType.EXPENSE)
      .reduce((acc, r) => acc + (r.compareAmount || 0), 0);

    // Estimate COGS / Direct Costs (look for accounts named / coded under COGS or Direct Expenses if present)
    const cogsRoots = roots.filter(
      (r) =>
        r.type === AccountType.EXPENSE &&
        (r.name.toLowerCase().includes('cogs') ||
          r.name.toLowerCase().includes('cost of goods') ||
          r.name.toLowerCase().includes('direct cost') ||
          r.code.startsWith('51') ||
          r.code.startsWith('50')),
    );
    const totalCogs = cogsRoots.reduce((acc, r) => acc + (r.amount || 0), 0);
    const compareTotalCogs = cogsRoots.reduce((acc, r) => acc + (r.compareAmount || 0), 0);

    const grossProfit = totalIncome - totalCogs;
    const compareGrossProfit = compareTotalIncome - compareTotalCogs;

    const netProfit = totalIncome - totalExpense;
    const compareNetProfit = compareTotalIncome - compareTotalExpense;

    const varianceNetProfit = netProfit - compareNetProfit;
    const percentageNetProfit = compareNetProfit !== 0 ? (varianceNetProfit / Math.abs(compareNetProfit)) * 100 : 0;

    return {
      income,
      totalIncome,
      compareTotalIncome,
      expense,
      totalExpense,
      compareTotalExpense,
      totalCogs,
      compareTotalCogs,
      grossProfit,
      compareGrossProfit,
      netProfit,
      compareNetProfit,
      varianceNetProfit,
      percentageNetProfit,
      from: fromStr,
      to: toStr,
      compareFrom: compareFromStr,
      compareTo: compareToStr,
      includeTagAccounts,
      showZeroBalances,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BALANCE SHEET (Market-Standard Hierarchical & Tag-Aware)
  // ─────────────────────────────────────────────────────────────────────────
  async getBalanceSheet(opts?: {
    asOf?: string;
    compareAsOf?: string;
    includeTagAccounts?: boolean;
    showZeroBalances?: boolean;
  }) {
    const asOfStr = opts?.asOf;
    const compareAsOfStr = opts?.compareAsOf;
    const includeTagAccounts = opts?.includeTagAccounts ?? true;
    const showZeroBalances = opts?.showZeroBalances ?? false;

    const asOfDate = parseToDate(asOfStr) || new Date();
    const compareAsOfDate = compareAsOfStr ? parseToDate(compareAsOfStr) : undefined;

    // 1. Fetch all chart of accounts
    const allAccounts = await this.prisma.chartOfAccount.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        balance: true,
        isGroup: true,
        isTagAccount: true,
        parentId: true,
      },
      orderBy: { code: 'asc' },
    });

    const accountMap = new Map<string, any>(
      allAccounts.map((a) => [a.id, { ...a, balance: Number(a.balance) }]),
    );

    // 2. Fetch raw transactions up to asOfDate grouped by (accountId, tagAccountId)
    const asOfRaw = await this.prisma.accountTransaction.groupBy({
      by: ['accountId', 'tagAccountId'],
      where: {
        transactionDate: { lte: asOfDate },
      },
      _sum: { debit: true, credit: true },
    });

    // 3. Fetch raw transactions up to compareAsOfDate if comparison requested
    let compareRaw: any[] = [];
    if (compareAsOfDate) {
      compareRaw = await (this.prisma.accountTransaction.groupBy as any)({
        by: ['accountId', 'tagAccountId'],
        where: {
          transactionDate: { lte: compareAsOfDate },
        },
        _sum: { debit: true, credit: true },
      });

    }

    // Canonical map for asOf totals (indexed by accountId)
    const amountsMap = new Map<string, { debit: number; credit: number }>();
    for (const r of asOfRaw) {
      const eid = r.accountId;
      if (!amountsMap.has(eid)) amountsMap.set(eid, { debit: 0, credit: 0 });
      const entry = amountsMap.get(eid)!;
      entry.debit += Number(r._sum.debit ?? 0);
      entry.credit += Number(r._sum.credit ?? 0);
    }

    // Canonical map for compare totals (indexed by accountId)
    const compareMap = new Map<string, { debit: number; credit: number }>();
    for (const r of compareRaw) {
      const eid = r.accountId;
      if (!compareMap.has(eid)) compareMap.set(eid, { debit: 0, credit: 0 });
      const entry = compareMap.get(eid)!;
      entry.debit += Number(r._sum.debit ?? 0);
      entry.credit += Number(r._sum.credit ?? 0);
    }

    // 4. Calculate Net Income for Current Period up to asOfDate and compareAsOfDate
    let incomeAsOf = 0, expenseAsOf = 0;
    let incomeCompare = 0, expenseCompare = 0;

    for (const r of asOfRaw) {
      const acc = accountMap.get(r.accountId);
      if (!acc) continue;
      const dr = Number(r._sum.debit ?? 0);
      const cr = Number(r._sum.credit ?? 0);
      if (acc.type === AccountType.INCOME) {
        incomeAsOf += (cr - dr);
      } else if (acc.type === AccountType.EXPENSE) {
        expenseAsOf += (dr - cr);
      }
    }

    for (const r of compareRaw) {
      const acc = accountMap.get(r.accountId);
      if (!acc) continue;
      const dr = Number(r._sum.debit ?? 0);
      const cr = Number(r._sum.credit ?? 0);
      if (acc.type === AccountType.INCOME) {
        incomeCompare += (cr - dr);
      } else if (acc.type === AccountType.EXPENSE) {
        expenseCompare += (dr - cr);
      }
    }

    const netProfitAsOf = incomeAsOf - expenseAsOf;
    const netProfitCompare = incomeCompare - expenseCompare;

    // 5. Tag breakdown map for display sub-rows under parent COA leaf nodes
    const tagBreakdownMap = new Map<
      string, // accountId
      Map<string, { asOfDebit: number; asOfCredit: number; compareDebit: number; compareCredit: number }>
    >();

    if (includeTagAccounts) {
      const upsertTag = (accountId: string, tagId: string) => {
        if (!tagBreakdownMap.has(accountId)) tagBreakdownMap.set(accountId, new Map());
        const inner = tagBreakdownMap.get(accountId)!;
        if (!inner.has(tagId)) inner.set(tagId, { asOfDebit: 0, asOfCredit: 0, compareDebit: 0, compareCredit: 0 });
        return inner.get(tagId)!;
      };

      for (const r of asOfRaw) {
        const tagId = (r as any).tagAccountId as string | null;
        if (!tagId) continue;
        const e = upsertTag(r.accountId, tagId);
        e.asOfDebit += Number(r._sum.debit ?? 0);
        e.asOfCredit += Number(r._sum.credit ?? 0);
      }

      for (const r of compareRaw) {
        const tagId = (r as any).tagAccountId as string | null;
        if (!tagId) continue;
        const e = upsertTag(r.accountId, tagId);
        e.compareDebit += Number(r._sum.debit ?? 0);
        e.compareCredit += Number(r._sum.credit ?? 0);
      }
    }

    // 6. Build Balance Sheet Leaf Nodes (ASSET, LIABILITY, EQUITY)
    const bsAccounts = allAccounts.filter((a) =>
      [AccountType.ASSET, AccountType.LIABILITY, AccountType.EQUITY].includes(a.type as any),
    );

    const calcNet = (type: AccountType, debit: number, credit: number) => {
      return type === AccountType.ASSET ? debit - credit : credit - debit;
    };

    const nodeMap = new Map<string, any>();

    for (const acc of bsAccounts) {
      const vAsOf = amountsMap.get(acc.id) ?? { debit: 0, credit: 0 };
      const vComp = compareMap.get(acc.id) ?? { debit: 0, credit: 0 };

      // Stored balance fallback if no transactions exist
      let amtAsOf = calcNet(acc.type as AccountType, vAsOf.debit, vAsOf.credit);
      let amtComp = calcNet(acc.type as AccountType, vComp.debit, vComp.credit);

      if (!asOfStr && vAsOf.debit === 0 && vAsOf.credit === 0) {
        amtAsOf = Number(acc.balance);
      }

      const tags = Array.from(
        (tagBreakdownMap.get(acc.id) ?? new Map()).entries(),
        ([tagAccountId, val]) => ({
          tagAccountId,
          amount: calcNet(acc.type as AccountType, val.asOfDebit, val.asOfCredit),
          compareAmount: calcNet(acc.type as AccountType, val.compareDebit, val.compareCredit),
        }),
      );

      nodeMap.set(acc.id, {
        ...acc,
        amount: amtAsOf,
        compareAmount: amtComp,
        _tagBreakdown: tags,
      });
    }

    // Ensure all ancestor group nodes exist in nodeMap
    const ensureAncestors = (nodeId: string) => {
      const acc = accountMap.get(nodeId);
      if (!acc) return;
      if (!nodeMap.has(nodeId)) {
        nodeMap.set(nodeId, {
          ...acc,
          amount: 0,
          compareAmount: 0,
          _tagBreakdown: [],
        });
      }
      if (acc.parentId) ensureAncestors(acc.parentId);
    };

    for (const nodeId of Array.from(nodeMap.keys())) {
      const node = nodeMap.get(nodeId);
      if (node?.parentId) ensureAncestors(node.parentId);
    }

    const childMap = new Map<string, any[]>();
    for (const node of nodeMap.values()) {
      if (node.parentId) {
        if (!childMap.has(node.parentId)) childMap.set(node.parentId, []);
        childMap.get(node.parentId)!.push(node);
      }
    }

    // Rollup amounts recursively
    const rollUp = (nodeId: string) => {
      const node = nodeMap.get(nodeId);
      if (!node) return;

      const children = childMap.get(nodeId) || [];
      if (children.length > 0) {
        node.amount = 0;
        node.compareAmount = 0;
      }

      for (const child of children) {
        rollUp(child.id);
        node.amount += child.amount || 0;
        node.compareAmount += child.compareAmount || 0;
      }
    };

    const roots = Array.from(nodeMap.values()).filter((n) => !n.parentId);
    for (const root of roots) {
      rollUp(root.id);
    }

    // Inject Net Profit / Loss into Equity Section
    const equityRoot = roots.find((r) => r.type === AccountType.EQUITY);
    const netIncomeNode = {
      id: 'VIRTUAL_NET_INCOME',
      code: '3999',
      name: 'Current Period Net Income (Profit / Loss)',
      type: AccountType.EQUITY,
      isGroup: false,
      isVirtual: true,
      amount: netProfitAsOf,
      compareAmount: netProfitCompare,
      parentId: equityRoot ? equityRoot.id : null,
      level: 1,
    };

    if (equityRoot) {
      equityRoot.amount += netProfitAsOf;
      equityRoot.compareAmount += netProfitCompare;
      if (!childMap.has(equityRoot.id)) childMap.set(equityRoot.id, []);
      childMap.get(equityRoot.id)!.push(netIncomeNode);
    }
    nodeMap.set(netIncomeNode.id, netIncomeNode);

    // 7. Flatten Tree for Display
    const flattenTree = (type: AccountType) => {
      const typeRoots = roots.filter((r) => r.type === type);
      typeRoots.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
      const list: any[] = [];

      const traverse = (nodeId: string, level = 0) => {
        const node = nodeMap.get(nodeId);
        if (!node) return;

        const variance = node.amount - (node.compareAmount || 0);
        const percentageChange =
          node.compareAmount && node.compareAmount !== 0
            ? (variance / Math.abs(node.compareAmount)) * 100
            : 0;

        const rowObj = {
          id: node.id,
          code: node.code,
          name: node.name,
          type: node.type,
          isGroup: node.isGroup ?? false,
          isVirtual: node.isVirtual ?? false,
          parentId: node.parentId,
          level,
          amount: node.amount,
          compareAmount: node.compareAmount || 0,
          variance,
          percentageChange,
          parent: node.parentId ? accountMap.get(node.parentId) : null,
        };

        if (showZeroBalances || Math.abs(node.amount) > 0.001 || Math.abs(node.compareAmount || 0) > 0.001) {
          list.push(rowObj);
        }

        // Tag Account display sub-rows (excluding self-referencing tag IDs and accounts already in childMap)
        const childIds = new Set((childMap.get(nodeId) || []).map((c) => c.id));
        if (!node.isGroup && includeTagAccounts && node._tagBreakdown?.length > 0) {
          const tags: Array<{ tagAccountId: string; amount: number; compareAmount: number }> =
            node._tagBreakdown.filter(
              (t: any) => t.tagAccountId !== node.id && !childIds.has(t.tagAccountId),
            );
          tags.sort((a, b) => {
            const ta = accountMap.get(a.tagAccountId);
            const tb = accountMap.get(b.tagAccountId);
            return (ta?.code ?? '').localeCompare(tb?.code ?? '');
          });

          for (const tag of tags) {
            const tagAcc = accountMap.get(tag.tagAccountId);
            const tagVar = tag.amount - tag.compareAmount;
            const tagPct = tag.compareAmount !== 0 ? (tagVar / Math.abs(tag.compareAmount)) * 100 : 0;

            if (showZeroBalances || Math.abs(tag.amount) > 0.001 || Math.abs(tag.compareAmount) > 0.001) {
              list.push({
                id: `${node.id}_${tag.tagAccountId}`,
                code: tagAcc ? tagAcc.code : tag.tagAccountId,
                name: tagAcc ? tagAcc.name : `Tag: ${tag.tagAccountId}`,
                type: node.type,
                isGroup: false,
                isTagAccount: true,
                parentId: node.id,
                level: level + 1,
                amount: tag.amount,
                compareAmount: tag.compareAmount,
                variance: tagVar,
                percentageChange: tagPct,
                parent: { id: node.id, code: node.code, name: node.name },
              });
            }
          }
        }

        const children = childMap.get(nodeId) || [];
        children.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
        for (const child of children) {
          traverse(child.id, level + 1);
        }
      };

      for (const root of typeRoots) {
        traverse(root.id, 0);
      }
      return list;
    };

    const assets = flattenTree(AccountType.ASSET);
    const liabilities = flattenTree(AccountType.LIABILITY);
    const equity = flattenTree(AccountType.EQUITY);

    // Summary calculations
    const assetRoots = roots.filter((r) => r.type === AccountType.ASSET);
    const liabilityRoots = roots.filter((r) => r.type === AccountType.LIABILITY);

    const totalAssets = assetRoots.reduce((s, r) => s + r.amount, 0);
    const totalLiabilities = liabilityRoots.reduce((s, r) => s + r.amount, 0);
    const totalEquity = (equityRoot ? equityRoot.amount : 0);

    const compareTotalAssets = assetRoots.reduce((s, r) => s + r.compareAmount, 0);
    const compareTotalLiabilities = liabilityRoots.reduce((s, r) => s + r.compareAmount, 0);
    const compareTotalEquity = (equityRoot ? equityRoot.compareAmount : 0);

    const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
    const compareTotalLiabilitiesAndEquity = compareTotalLiabilities + compareTotalEquity;

    const workingCapital = totalAssets - totalLiabilities;
    const compareWorkingCapital = compareTotalAssets - compareTotalLiabilities;

    const balanced = Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.01;

    return {
      assets,
      totalAssets,
      compareTotalAssets,
      liabilities,
      totalLiabilities,
      compareTotalLiabilities,
      equity,
      totalEquity,
      compareTotalEquity,
      totalLiabilitiesAndEquity,
      compareTotalLiabilitiesAndEquity,
      currentNetIncome: netProfitAsOf,
      compareCurrentNetIncome: netProfitCompare,
      workingCapital,
      compareWorkingCapital,
      balanced,
      asOf: asOfStr,
      compareAsOf: compareAsOfStr,
      includeTagAccounts,
      showZeroBalances,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ACCOUNT ACTIVITY SUMMARY  (dashboard-style)
  // ─────────────────────────────────────────────────────────────────────────
  async getAccountSummary(from?: string, to?: string) {
    const dateFilter: any = {};
    const fromDate = parseFromDate(from);
    const toDate = parseToDate(to);
    if (fromDate) dateFilter.gte = fromDate;
    if (toDate) dateFilter.lte = toDate;

    const bySource = await this.prisma.accountTransaction.groupBy({
      by: ['sourceType'],
      where: Object.keys(dateFilter).length
        ? { transactionDate: dateFilter }
        : undefined,
      _sum: { debit: true, credit: true },
      _count: { id: true },
    });

    const byType = await this.prisma.accountTransaction.groupBy({
      by: ['accountId'],
      where: Object.keys(dateFilter).length
        ? { transactionDate: dateFilter }
        : undefined,
      _sum: { debit: true, credit: true },
    });

    // Enrich with account type
    const accountIds = byType.map((b) => b.accountId);
    const accountTypes = await this.prisma.chartOfAccount.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, type: true },
    });
    const typeMap = new Map(accountTypes.map((a) => [a.id, a.type]));

    const byAccountType: Record<string, { debit: number; credit: number }> = {};
    for (const b of byType) {
      const t = typeMap.get(b.accountId) ?? 'UNKNOWN';
      if (!byAccountType[t]) byAccountType[t] = { debit: 0, credit: 0 };
      byAccountType[t].debit += Number(b._sum.debit ?? 0);
      byAccountType[t].credit += Number(b._sum.credit ?? 0);
    }

    return {
      bySourceType: bySource.map((s) => ({
        sourceType: s.sourceType,
        count: s._count.id,
        debit: Number(s._sum.debit ?? 0),
        credit: Number(s._sum.credit ?? 0),
      })),
      byAccountType,
      from,
      to,
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
    const fromDate = parseFromDate(from);
    const toDate = parseToDate(to);
    if (fromDate) dateFilter.gte = fromDate;
    if (toDate) dateFilter.lte = toDate;

    const agg = await this.prisma.accountTransaction.groupBy({
      by: ['accountId'],
      where: {
        accountId: { in: accountIds },
        ...(Object.keys(dateFilter).length
          ? { transactionDate: dateFilter }
          : {}),
      },
      _sum: { debit: true, credit: true },
    });

    return new Map(
      agg.map((a) => [
        a.accountId,
        {
          debit: Number(a._sum.debit ?? 0),
          credit: Number(a._sum.credit ?? 0),
        },
      ]),
    );
  }

  async getSubaccountSummary(
    parentAccountId: string,
    subAccountIds: string[],
    from?: string,
    to?: string,
  ) {
    const parentAccount = await this.prisma.chartOfAccount.findUnique({
      where: { id: parentAccountId },
      select: { id: true, code: true, name: true, type: true },
    });
    if (!parentAccount) throw new NotFoundException('Parent account not found');

    const fromDate = parseFromDate(from);
    const toDate = parseToDate(to);

    // If subAccountIds is empty, load all sub-accounts of the parent account
    let targetIds = subAccountIds;
    if (!targetIds || targetIds.length === 0) {
      const children = await this.prisma.chartOfAccount.findMany({
        where: { parentId: parentAccountId, isActive: true },
        select: { id: true },
      });
      targetIds = children.map((c) => c.id);
    }

    if (targetIds.length === 0) {
      return {
        parentAccount,
        rows: [],
        totals: { openingBalance: 0, debit: 0, credit: 0, closingBalance: 0 },
      };
    }

    const subAccounts = await this.prisma.chartOfAccount.findMany({
      where: { id: { in: targetIds } },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });

    // 1. Opening Balance aggregation
    const openingWhere: any = {
      AND: [
        {
          OR: [
            { tagAccountId: { in: targetIds } },
            { accountId: { in: targetIds } },
          ],
        },
      ],
    };
    if (fromDate) {
      openingWhere.AND.push({
        OR: [
          { sourceType: 'OPENING_BALANCE' },
          {
            transactionDate: { lt: fromDate },
            sourceType: { not: 'OPENING_BALANCE' },
          },
        ],
      });
    } else {
      openingWhere.AND.push({ sourceType: 'OPENING_BALANCE' });
    }

    // 2. Activity aggregation
    const activityWhere: any = {
      AND: [
        {
          OR: [
            { tagAccountId: { in: targetIds } },
            { accountId: { in: targetIds } },
          ],
        },
        { sourceType: { not: 'OPENING_BALANCE' } },
      ],
    };
    if (fromDate || toDate) {
      const dateConditions: any = {};
      if (fromDate) dateConditions.gte = fromDate;
      if (toDate) dateConditions.lte = toDate;
      activityWhere.AND.push({ transactionDate: dateConditions });
    }

    const [openingAggs, activityAggs] = await Promise.all([
      this.prisma.accountTransaction.groupBy({
        by: ['accountId', 'tagAccountId'],
        where: openingWhere,
        _sum: { debit: true, credit: true },
      }),
      this.prisma.accountTransaction.groupBy({
        by: ['accountId', 'tagAccountId'],
        where: activityWhere,
        _sum: { debit: true, credit: true },
      }),
    ]);

    const openingMap = new Map<string, { debit: number; credit: number }>();
    openingAggs.forEach((agg) => {
      const eid = agg.tagAccountId || agg.accountId;
      if (eid) {
        const existing = openingMap.get(eid) || { debit: 0, credit: 0 };
        openingMap.set(eid, {
          debit: existing.debit + Number(agg._sum.debit ?? 0),
          credit: existing.credit + Number(agg._sum.credit ?? 0),
        });
      }
    });

    const activityMap = new Map<string, { debit: number; credit: number }>();
    activityAggs.forEach((agg) => {
      const eid = agg.tagAccountId || agg.accountId;
      if (eid) {
        const existing = activityMap.get(eid) || { debit: 0, credit: 0 };
        activityMap.set(eid, {
          debit: existing.debit + Number(agg._sum.debit ?? 0),
          credit: existing.credit + Number(agg._sum.credit ?? 0),
        });
      }
    });

    let grandOpening = 0;
    let grandDebit = 0;
    let grandCredit = 0;
    let grandClosing = 0;

    const rows = subAccounts.map((sa) => {
      const op = openingMap.get(sa.id) || { debit: 0, credit: 0 };
      const act = activityMap.get(sa.id) || { debit: 0, credit: 0 };

      // Balance = Debit - Credit
      const openingBalance = op.debit - op.credit;
      const debit = act.debit;
      const credit = act.credit;
      const closingBalance = openingBalance + debit - credit;

      grandOpening += openingBalance;
      grandDebit += debit;
      grandCredit += credit;
      grandClosing += closingBalance;

      return {
        id: sa.id,
        code: sa.code,
        name: sa.name,
        openingBalance,
        debit,
        credit,
        closingBalance,
      };
    });

    return {
      parentAccount,
      rows,
      totals: {
        openingBalance: grandOpening,
        debit: grandDebit,
        credit: grandCredit,
        closingBalance: grandClosing,
      },
    };
  }
}
