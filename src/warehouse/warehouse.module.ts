import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { WarehouseService } from './warehouse.service';
import { WarehouseController } from './warehouse.controller';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { StockMovementService } from './stock-movement.service';
import { StockOperationController } from './stock-operation.controller';
import { TransferRequestController } from './transfer-request.controller';
import { TransferRequestService } from './transfer-request.service';
import { StockLedgerModule } from './stock-ledger/stock-ledger.module';

@Module({
  imports: [DatabaseModule, StockLedgerModule],
  controllers: [
    WarehouseController,
    InventoryController,
    StockOperationController,
    TransferRequestController,
  ],
  providers: [WarehouseService, InventoryService, StockMovementService, TransferRequestService],
  exports: [WarehouseService, InventoryService, StockMovementService, TransferRequestService],
})
export class WarehouseModule { }
