import { Controller, Get, Param, Query, UseGuards, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('Account Ledger')
@Controller('api/finance/account-ledger')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AccountLedgerController {
    constructor(private prisma: PrismaService) {}

    /**
     * GET /api/finance/account-ledger
     * All accounts with their current balance — Trial Balance view
     */
    @Get()
    @ApiOperation({ summary: 'Get all accounts with balances (Trial Balance)' })
    async getTrialBalance() {
        const accounts = await this.prisma.chartOfAccount.findMany({
            where: { isGroup: false, isActive: true },
            select: {
                id: true, code: true, name: true, type: true, balance: true,
                parent: { select: { code: true, name: true } },
            },
            orderBy: { code: 'asc' },
        });
        return { status: true, data: accounts };
    }

    /**
     * GET /api/finance/account-ledger/:accountId/transactions
     * Full transaction history for a single account
     */
    @Get(':accountId/transactions')
    @ApiOperation({ summary: 'Get transaction history for an account' })
    @ApiQuery({ name: 'page', required: false, type: Number })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiQuery({ name: 'from', required: false, type: String, description: 'ISO date' })
    @ApiQuery({ name: 'to', required: false, type: String, description: 'ISO date' })
    @ApiQuery({ name: 'sourceType', required: false, type: String })
    async getAccountTransactions(
        @Param('accountId') accountId: string,
        @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
        @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('sourceType') sourceType?: string,
    ) {
        const where: any = { accountId };
        if (from || to) {
            where.transactionDate = {
                ...(from && { gte: new Date(from) }),
                ...(to && { lte: new Date(to) }),
            };
        }
        if (sourceType) where.sourceType = sourceType;

        const [account, transactions, total] = await Promise.all([
            this.prisma.chartOfAccount.findUnique({
                where: { id: accountId },
                select: { id: true, code: true, name: true, type: true, balance: true },
            }),
            this.prisma.accountTransaction.findMany({
                where,
                orderBy: { transactionDate: 'asc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.prisma.accountTransaction.count({ where }),
        ]);

        return {
            status: true,
            data: {
                account,
                transactions,
                pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
            },
        };
    }
}
