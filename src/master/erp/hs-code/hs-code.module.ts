import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { HsCodeService } from './hs-code.service';
import { HsCodeController } from './hs-code.controller';
import { HsCodeBulkUploadController } from './hs-code-bulk-upload.controller';
import { HsCodeBulkUploadService } from './hs-code-bulk-upload.service';
import { HsCodeUploadProcessor } from '../../../queue/processors/hscode-upload.processor';
import { HsCodeCsvParserService } from '../../../common/services/hscode-csv-parser.service';
import { HsCodeValidatorService } from '../../../common/services/hscode-validator.service';
import { UploadEventsService } from '../../../finance/item/upload-events.service';
import { DatabaseModule } from '../../../database/database.module';

@Module({
    imports: [
        DatabaseModule,
        BullModule.registerQueue({
            name: 'hscode-upload',
        }),
    ],
    controllers: [HsCodeController, HsCodeBulkUploadController],
    providers: [
        HsCodeService,
        HsCodeBulkUploadService,
        HsCodeUploadProcessor,
        HsCodeCsvParserService,
        HsCodeValidatorService,
        UploadEventsService,
    ],
    exports: [HsCodeService],
})
export class HsCodeModule { }
