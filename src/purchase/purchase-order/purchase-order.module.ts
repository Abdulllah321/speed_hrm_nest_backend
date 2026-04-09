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

@Module({
  imports: [
    PrismaModule,
    DatabaseModule,
    BullModule.registerQueue({ name: 'po-upload' }),
  ],
  controllers: [PurchaseOrderController, PoBulkUploadController],
  providers: [
    PurchaseOrderService,
    PoBulkUploadService,
    PoUploadProcessor,
    PoCsvParserService,
    PoValidatorService,
    UploadEventsService,
  ],
  exports: [PurchaseOrderService],
})
export class PurchaseOrderModule {}
