import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PurchaseOrderService } from './purchase-order.service';
import { PurchaseOrderController } from './purchase-order.controller';
import { PoBulkUploadService } from './po-bulk-upload.service';
import { PoBulkUploadController } from './po-bulk-upload.controller';
import { PoUploadProcessor } from '../../queue/processors/po-upload.processor';
import { PoCsvParserService } from '../../common/services/po-csv-parser.service';
import { PoValidatorService } from '../../common/services/po-validator.service';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { DatabaseModule } from '../../database/database.module';
import { ExportHistoryModule } from '../../warehouse/export-history/export-history.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { UploadModule } from '../../upload/upload.module';
import { PoRegisterExportService } from './po-register-export.service';
import { PoRegisterExportProcessor } from './po-register-export.processor';

@Module({
  imports: [
    PrismaModule,
    DatabaseModule,
    ExportHistoryModule,
    NotificationsModule,
    UploadModule,
    BullModule.registerQueue(
      { name: 'po-upload' },
      { name: 'po-register-export' },
    ),
  ],
  controllers: [PurchaseOrderController, PoBulkUploadController],
  providers: [
    PurchaseOrderService,
    PoBulkUploadService,
    PoUploadProcessor,
    PoCsvParserService,
    PoValidatorService,
    UploadEventsService,
    PoRegisterExportService,
    PoRegisterExportProcessor,
  ],
  exports: [PurchaseOrderService, PoRegisterExportService],
})
export class PurchaseOrderModule {}
