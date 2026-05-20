import { Module } from '@nestjs/common';
import { PosClaimsController } from './pos-claims.controller';
import { PosClaimsService } from './pos-claims.service';
import { DatabaseModule } from '../database/database.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { StockLedgerModule } from '../warehouse/stock-ledger/stock-ledger.module';

@Module({
    imports: [DatabaseModule, WarehouseModule, StockLedgerModule],
    controllers: [PosClaimsController],
    providers: [PosClaimsService],
    exports: [PosClaimsService],
})
export class PosClaimsModule { }
