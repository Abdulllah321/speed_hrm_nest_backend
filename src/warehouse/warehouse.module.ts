import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { WarehouseService } from './warehouse.service';
import { WarehouseController } from './warehouse.controller';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { StockMovementService } from './stock-movement.service';
import { StockOperationController } from './stock-operation.controller';

@Module({
    imports: [DatabaseModule],
    controllers: [WarehouseController, InventoryController, StockOperationController],
    providers: [WarehouseService, InventoryService, StockMovementService],
    exports: [WarehouseService, InventoryService, StockMovementService],
})
export class WarehouseModule { }
