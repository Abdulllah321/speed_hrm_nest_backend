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
import { StockRequisitionController } from './stock-requisition/stock-requisition.controller';
import { StockRequisitionService } from './stock-requisition/stock-requisition.service';
import { SrnBulkUploadController } from './stock-requisition/srn-bulk-upload.controller';
import { SrnBulkUploadService } from './stock-requisition/srn-bulk-upload.service';
import { SrnUploadProcessor } from '../queue/processors/srn-upload.processor';
import { SrnCsvParserService } from '../common/services/srn-csv-parser.service';
import { SrnValidatorService } from '../common/services/srn-validator.service';
import { UploadEventsService } from '../finance/item/upload-events.service';
import { ExportHistoryModule } from './export-history/export-history.module';

@Module({
  imports: [
    DatabaseModule,
    StockLedgerModule,
    StockUploadModule,
    StockAdjustmentModule,
    NotificationsModule,
    BullModule.registerQueue({ name: 'delivery-note-export' }),
    BullModule.registerQueue({ name: 'srn-upload' }),
    ExportHistoryModule,
  ],
  controllers: [
    WarehouseController,
    InventoryController,
    StockOperationController,
    TransferRequestController,
    DeliveryNoteExportController,
    StockRequisitionController,
    SrnBulkUploadController,
  ],
  providers: [
    WarehouseService,
    InventoryService,
    StockMovementService,
    TransferRequestService,
    DeliveryNoteExportService,
    DeliveryNoteExportProcessor,
    StockRequisitionService,
    SrnBulkUploadService,
    SrnUploadProcessor,
    SrnCsvParserService,
    SrnValidatorService,
    UploadEventsService,
  ],
  exports: [
    WarehouseService,
    InventoryService,
    StockMovementService,
    TransferRequestService,
    DeliveryNoteExportService,
    StockAdjustmentModule,
    StockRequisitionService,
    ExportHistoryModule,
  ],
})
export class WarehouseModule { }


