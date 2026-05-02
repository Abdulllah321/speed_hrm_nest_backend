import { Module } from '@nestjs/common';
import { PosSalesController } from './pos-sales.controller';
import { PosSalesService } from './pos-sales.service';
import { DatabaseModule } from '../database/database.module';
import { StockLedgerModule } from '../warehouse/stock-ledger/stock-ledger.module';
import { FbrService } from './fbr.service';
import { CustomerModule } from '../sales/customer/customer.module';

@Module({
    imports: [DatabaseModule, StockLedgerModule, CustomerModule],
    controllers: [PosSalesController],
    providers: [PosSalesService, FbrService],
    exports: [PosSalesService],
})
export class PosSalesModule { }
