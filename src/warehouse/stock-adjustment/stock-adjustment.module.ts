import { Module } from '@nestjs/common';
import { StockAdjustmentService } from './stock-adjustment.service';
import { StockAdjustmentController } from './stock-adjustment.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { StockLedgerModule } from '../stock-ledger/stock-ledger.module';

@Module({
  imports: [StockLedgerModule],
  controllers: [StockAdjustmentController],
  providers: [StockAdjustmentService, PrismaService],
  exports: [StockAdjustmentService],
})
export class StockAdjustmentModule {}
