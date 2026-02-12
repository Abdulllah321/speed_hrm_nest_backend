import { Controller, Get, Query } from '@nestjs/common';
import { StockLedgerService } from './stock-ledger.service';
import { MovementType } from '@prisma/client';

@Controller('warehouse/stock-ledger')
export class StockLedgerController {
    constructor(private readonly stockLedgerService: StockLedgerService) { }

    @Get()
    async findAll(
        @Query('warehouseId') warehouseId?: string,
        @Query('movementType') movementType?: MovementType,
        @Query('itemId') itemId?: string,
    ) {
        return this.stockLedgerService.findAll({
            warehouseId,
            movementType,
            itemId,
        });
    }
}
