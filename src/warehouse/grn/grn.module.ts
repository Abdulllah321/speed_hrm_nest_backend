import { Module } from '@nestjs/common';
import { GrnService } from './grn.service';
import { GrnController } from './grn.controller';
import { StockLedgerModule } from '../stock-ledger/stock-ledger.module';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [StockLedgerModule, DatabaseModule],
  controllers: [GrnController],
  providers: [GrnService],
  exports: [GrnService],
})
export class GrnModule {}
