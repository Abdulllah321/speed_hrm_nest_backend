import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ItemService } from './item.service';
import { ItemController } from './item.controller';
import { ItemBulkUploadController } from './item-bulk-upload.controller';
import { ItemBulkUploadService } from './item-bulk-upload.service';
import { DatabaseModule } from '../../database/database.module';
import { UploadProcessor } from '../../queue/processors/upload.processor';
import { CsvParserService } from '../../common/services/csv-parser.service';
import { MasterDataService } from '../../common/services/master-data.service';
import { ItemValidatorService } from '../../common/services/item-validator.service';
import { UploadEventsService } from './upload-events.service';

@Module({
    imports: [
        DatabaseModule,
        BullModule.registerQueue({
            name: 'item-upload',
        }),
    ],
    controllers: [ItemController, ItemBulkUploadController],
    providers: [
        ItemService,
        ItemBulkUploadService,
        UploadProcessor,
        CsvParserService,
        MasterDataService,
        ItemValidatorService,
        UploadEventsService,
    ],
    exports: [ItemService],
})
export class ItemModule { }
