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
import { StockUploadModule } from './stock-upload/stock-upload.module';
import { StockAdjustmentModule } from './stock-adjustment/stock-adjustment.module';
import { BullModule } from '@nestjs/bull';
import { NotificationsModule } from '../notifications/notifications.module';
import { DeliveryNoteExportController } from './delivery-note-export.controller';
import { DeliveryNoteExportService } from './delivery-note-export.service';
import { DeliveryNoteExportProcessor } from './delivery-note-export.processor';

@Module({
  imports: [
    DatabaseModule,
    StockLedgerModule,
    StockUploadModule,
    StockAdjustmentModule,
    NotificationsModule,
    BullModule.registerQueue({ name: 'delivery-note-export' }),
  ],
  controllers: [
    WarehouseController,
    InventoryController,
    StockOperationController,
    TransferRequestController,
    DeliveryNoteExportController,
  ],
  providers: [
    WarehouseService,
    InventoryService,
    StockMovementService,
    TransferRequestService,
    DeliveryNoteExportService,
    DeliveryNoteExportProcessor,
  ],
  exports: [
    WarehouseService,
    InventoryService,
    StockMovementService,
    TransferRequestService,
    DeliveryNoteExportService,
    StockAdjustmentModule,
  ],
})
export class WarehouseModule { }

