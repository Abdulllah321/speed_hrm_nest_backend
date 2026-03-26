import { Module } from '@nestjs/common';
import { StockLedgerService } from './stock-ledger.service';
import { PrismaService } from '../../prisma/prisma.service';

import { StockLedgerController } from './stock-ledger.controller';

@Module({
  controllers: [StockLedgerController],
  providers: [StockLedgerService, PrismaService],
  exports: [StockLedgerService],
})
export class StockLedgerModule {}
