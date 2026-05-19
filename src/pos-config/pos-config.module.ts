import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PosConfigController } from './pos-config.controller';
import { PosConfigService } from './pos-config.service';
import { VoucherService } from './voucher.service';
import { MerchantService } from './merchant.service';
import { AllianceBulkUploadController } from './alliance-bulk-upload.controller';
import { AllianceBulkUploadService } from './alliance-bulk-upload.service';
import { AllianceUploadProcessor } from '../queue/processors/alliance-upload.processor';
import { AllianceCsvParserService } from '../common/services/alliance-csv-parser.service';
import { AllianceValidatorService } from '../common/services/alliance-validator.service';
import { UploadEventsService } from '../finance/item/upload-events.service';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [
        DatabaseModule,
        BullModule.registerQueue({
            name: 'alliance-upload',
        }),
    ],
    controllers: [PosConfigController, AllianceBulkUploadController],
    providers: [
        PosConfigService,
        VoucherService,
        MerchantService,
        AllianceBulkUploadService,
        AllianceUploadProcessor,
        AllianceCsvParserService,
        AllianceValidatorService,
        UploadEventsService,
    ],
    exports: [PosConfigService, VoucherService, MerchantService],
})
export class PosConfigModule { }
