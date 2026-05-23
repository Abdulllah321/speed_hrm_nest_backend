import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ItemService } from './item.service';
import { ItemController } from './item.controller';
import { ItemBulkUploadController } from './item-bulk-upload.controller';
import { ItemBulkUploadService } from './item-bulk-upload.service';
import { ItemUpdateBulkUploadController } from './item-update-bulk-upload.controller';
import { ItemUpdateBulkUploadService } from './item-update-bulk-upload.service';
import { ItemExportController } from './item-export.controller';
import { ItemExportService } from './item-export.service';
import { ItemExportProcessor } from './item-export.processor';
import { DatabaseModule } from '../../database/database.module';
import { UploadProcessor } from '../../queue/processors/upload.processor';
import { ItemUpdateUploadProcessor } from '../../queue/processors/item-update-upload.processor';
import { CsvParserService } from '../../common/services/csv-parser.service';
import { ItemUpdateCsvParserService } from '../../common/services/item-update-csv-parser.service';
import { MasterDataService } from '../../common/services/master-data.service';
import { ItemValidatorService } from '../../common/services/item-validator.service';
import { ItemUpdateValidatorService } from '../../common/services/item-update-validator.service';
import { UploadEventsService } from './upload-events.service';

@Module({
    imports: [
        DatabaseModule,
        BullModule.registerQueue(
            { name: 'item-upload' },
            { name: 'item-export' },
            { name: 'item-update-upload' },
        ),
    ],
    controllers: [
        ItemController,
        ItemBulkUploadController,
        ItemUpdateBulkUploadController,
        ItemExportController,
    ],
    providers: [
        ItemService,
        ItemBulkUploadService,
        ItemUpdateBulkUploadService,
        UploadProcessor,
        ItemUpdateUploadProcessor,
        CsvParserService,
        ItemUpdateCsvParserService,
        MasterDataService,
        ItemValidatorService,
        ItemUpdateValidatorService,
        UploadEventsService,
        ItemExportService,
        ItemExportProcessor,
    ],
    exports: [ItemService],
})
export class ItemModule { }
