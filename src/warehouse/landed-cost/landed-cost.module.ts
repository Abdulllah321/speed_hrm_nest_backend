import { Module } from '@nestjs/common';
import { LandedCostService } from './landed-cost.service';
import { LandedCostController } from './landed-cost.controller';
import { StockLedgerModule } from '../stock-ledger/stock-ledger.module';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule, StockLedgerModule],
  controllers: [LandedCostController],
  providers: [LandedCostService],
  exports: [LandedCostService],
})
export class LandedCostModule {}
