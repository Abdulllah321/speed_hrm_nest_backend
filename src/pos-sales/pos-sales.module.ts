import { Module } from '@nestjs/common';
import { PosSalesController } from './pos-sales.controller';
import { PosSalesService } from './pos-sales.service';
import { DatabaseModule } from '../database/database.module';
import { StockLedgerModule } from '../warehouse/stock-ledger/stock-ledger.module';

@Module({
    imports: [DatabaseModule, StockLedgerModule],
    controllers: [PosSalesController],
    providers: [PosSalesService],
    exports: [PosSalesService],
})
export class PosSalesModule { }
