import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountType } from '@prisma/client';

export interface JournalLine {
    accountId: string;
    debit: number;
    credit: number;
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

    constructor(private prisma: PrismaService) {}

    /**
     * Post journal lines:
     *  - Updates ChartOfAccount.balance
     *  - Creates AccountTransaction rows for full audit trail
     */
    async postLines(lines: JournalLine[], options: PostOptions, tx?: any): Promise<void> {
        const client = tx ?? this.prisma;
        const date = options.transactionDate ?? new Date();

        const accountIds = [...new Set(lines.map(l => l.accountId))];
        const accounts = await client.chartOfAccount.findMany({
            where: { id: { in: accountIds } },
            select: { id: true, type: true, balance: true },
        });
        const accountMap = new Map<string, { type: AccountType; balance: number }>(
            accounts.map((a: any) => [a.id, { type: a.type, balance: Number(a.balance) }])
        );

        for (const line of lines) {
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
                    debit: line.debit,
                    credit: line.credit,
                    balanceAfter: newBalance,
                    sourceType: options.sourceType,
                    sourceId: options.sourceId,
                    sourceRef: options.sourceRef,
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
