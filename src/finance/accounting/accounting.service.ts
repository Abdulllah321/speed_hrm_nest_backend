import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountType } from '@prisma/client';

import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
export interface JournalLine {
    accountId: string;
    tagAccountId?: string;  // optional sub-ledger tag for drill-down analysis
    debit: number;
    credit: number;
    // ── Per-line details (optional — falls back to PostOptions.description) ──
    narration?: string;       // line-level narration
    refBillNo?: string;       // bill/ref number for this specific line
    isTaxApplicable?: boolean; // withholding tax flag for this line
}

export interface PostOptions {
    sourceType: string;   // e.g. 'PURCHASE_INVOICE'
    sourceId: string;     // document UUID
    sourceRef: string;    // human-readable e.g. 'PI-2026-0001'
    description?: string;
    transactionDate?: Date;
}

@Injectable()
export class AccountingService {
    private readonly logger = new Logger(AccountingService.name);

    constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

    /**
     * Post journal lines:
     *  - Updates ChartOfAccount.balance
     *  - Creates AccountTransaction rows for full audit trail
     */
    async postLines(lines: JournalLine[], options: PostOptions, tx?: any): Promise<void> {
        const client = tx ?? this.prisma;
        const date = options.transactionDate ?? new Date();

        // Sanitize: coerce empty-string tagAccountId to undefined so FK is never violated
        const sanitizedLines = lines.map(l => ({
            ...l,
            tagAccountId: l.tagAccountId && l.tagAccountId.trim() !== '' ? l.tagAccountId : undefined,
        }));

        const accountIds = [...new Set(sanitizedLines.map(l => l.accountId))];
        const accounts = await client.chartOfAccount.findMany({
            where: { id: { in: accountIds } },
            select: { id: true, type: true, balance: true },
        });
        const accountMap = new Map<string, { type: AccountType; balance: number }>(
            accounts.map((a: any) => [a.id, { type: a.type, balance: Number(a.balance) }])
        );

        for (const line of sanitizedLines) {
            const account = accountMap.get(line.accountId);
            if (!account) {
                this.logger.warn(`Account ${line.accountId} not found — skipping`);
                continue;
            }

            const delta = this.calculateDelta(account.type, line.debit, line.credit);
            if (delta === 0 && line.debit === 0 && line.credit === 0) continue;

            const newBalance = account.balance + delta;

            // Update running balance on account
            await client.chartOfAccount.update({
                where: { id: line.accountId },
                data: { balance: { increment: delta } },
            });

            // Write transaction row for audit trail
            await client.accountTransaction.create({
                data: {
                    accountId: line.accountId,
                    tagAccountId: line.tagAccountId ?? null,
                    debit: line.debit,
                    credit: line.credit,
                    balanceAfter: newBalance,
                    sourceType: options.sourceType,
                    sourceId: options.sourceId,
                    sourceRef: options.sourceRef,
                    // Per-line narration takes priority; fall back to voucher-level description
                    narration: line.narration ?? null,
                    refBillNo: line.refBillNo ?? null,
                    isTaxApplicable: line.isTaxApplicable ?? false,
                    description: options.description ?? null,
                    transactionDate: date,
                },
            });

            // Update local map so subsequent lines in same call see updated balance
            accountMap.set(line.accountId, { type: account.type, balance: newBalance });
        }
    }

    /**
     * Reverse previously posted lines (cancellation / reversal).
     * Creates new AccountTransaction rows with swapped debit/credit.
     */
    async reverseLines(lines: JournalLine[], options: PostOptions, tx?: any): Promise<void> {
        const reversed = lines.map(l => ({
            accountId: l.accountId,
            debit: l.credit,
            credit: l.debit,
        }));
        return this.postLines(reversed, {
            ...options,
            description: `REVERSAL: ${options.description ?? options.sourceRef}`,
        }, tx);
    }

    private calculateDelta(type: AccountType, debit: number, credit: number): number {
        switch (type) {
            case 'ASSET':
            case 'EXPENSE':
                return debit - credit;
            case 'LIABILITY':
            case 'EQUITY':
            case 'INCOME':
                return credit - debit;
            default:
                return 0;
        }
    }
}
