import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { StockBulkUploadController } from './stock-bulk-upload.controller';
import { StockBulkUploadService } from './stock-bulk-upload.service';
import { StockUploadProcessor } from '../../queue/processors/stock-upload.processor';
import { StockUploadCsvParserService } from '../../common/services/stock-upload-csv-parser.service';
import { StockUploadValidatorService } from '../../common/services/stock-upload-validator.service';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { DatabaseModule } from '../../database/database.module';

@Module({
    imports: [
        DatabaseModule,
        BullModule.registerQueue({ name: 'stock-upload' }),
    ],
    controllers: [StockBulkUploadController],
    providers: [
        StockBulkUploadService,
        StockUploadProcessor,
        StockUploadCsvParserService,
        StockUploadValidatorService,
        UploadEventsService,
    ],
    exports: [StockBulkUploadService],
})
export class StockUploadModule { }
