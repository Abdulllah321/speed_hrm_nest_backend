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

// Merchant Uploader & Exporter imports
import { MerchantBulkUploadController } from './merchant-bulk-upload.controller';
import { MerchantBulkUploadService } from './merchant-bulk-upload.service';
import { MerchantUploadProcessor } from '../queue/processors/merchant-upload.processor';
import { MerchantCsvParserService } from '../common/services/merchant-csv-parser.service';
import { MerchantValidatorService } from '../common/services/merchant-validator.service';
import { MerchantExportController } from './merchant-export.controller';
import { MerchantExportService } from './merchant-export.service';
import { MerchantExportProcessor } from './merchant-export.processor';

@Module({
    imports: [
        DatabaseModule,
        BullModule.registerQueue(
            { name: 'alliance-upload' },
            { name: 'merchant-upload' },
            { name: 'merchant-export' },
        ),
    ],
    controllers: [
        PosConfigController,
        AllianceBulkUploadController,
        MerchantBulkUploadController,
        MerchantExportController,
    ],
    providers: [
        PosConfigService,
        VoucherService,
        MerchantService,
        AllianceBulkUploadService,
        AllianceUploadProcessor,
        AllianceCsvParserService,
        AllianceValidatorService,
        UploadEventsService,
        // Merchant Providers
        MerchantBulkUploadService,
        MerchantUploadProcessor,
        MerchantCsvParserService,
        MerchantValidatorService,
        MerchantExportService,
        MerchantExportProcessor,
    ],
    exports: [PosConfigService, VoucherService, MerchantService],
})
export class PosConfigModule { }
