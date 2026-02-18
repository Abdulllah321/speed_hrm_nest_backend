import { Module } from '@nestjs/common';
import { GrnService } from './grn.service';
import { GrnController } from './grn.controller';
import { StockLedgerModule } from '../stock-ledger/stock-ledger.module';

@Module({
  imports: [StockLedgerModule],
  controllers: [GrnController],
  providers: [GrnService],
  exports: [GrnService],
})
export class GrnModule {}
