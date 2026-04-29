import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';
import { AccountingService } from '../accounting/accounting.service';

@Injectable()
export class OpeningBalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountingService: AccountingService,
  ) {}

  async createOpeningBalance(dto: CreateOpeningBalanceDto) {
    const { accountId, type, amount, date } = dto;

    // Validate account exists
    const account = await this.prisma.chartOfAccount.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      throw new BadRequestException('Account not found');
    }

    if (account.isGroup) {
      throw new BadRequestException('Cannot set opening balance for group accounts');
    }

    // Create journal entry for opening balance
    const transactionDate = date ? new Date(date) : new Date();
    
    // Determine debit and credit amounts based on type
    const debit = type === 'DEBIT' ? amount : 0;
    const credit = type === 'CREDIT' ? amount : 0;

    // Post the opening balance transaction
    await this.accountingService.postLines(
      [
        {
          accountId,
          debit,
          credit,
        },
      ],
      {
        sourceType: 'OPENING_BALANCE',
        sourceId: accountId,
        sourceRef: `Opening Balance - ${account.code}`,
        description: `Opening Balance for ${account.name}`,
        transactionDate,
      },
    );

    return {
      status: true,
      message: 'Opening balance created successfully',
    };
  }

  async getOpeningBalances() {
    const transactions = await this.prisma.accountTransaction.findMany({
      where: {
        sourceType: 'OPENING_BALANCE',
      },
      include: {
        account: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
          },
        },
      },
      orderBy: {
        transactionDate: 'desc',
      },
    });

    return {
      status: true,
      data: transactions,
    };
  }
}
