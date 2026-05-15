import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { CustomerBulkUploadService } from './customer-bulk-upload.service';
import { CustomerBulkUploadController } from './customer-bulk-upload.controller';
import { CustomerUploadProcessor } from '../../queue/processors/customer-upload.processor';
import { CustomerCsvParserService } from '../../common/services/customer-csv-parser.service';
import { CustomerValidatorService } from '../../common/services/customer-validator.service';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { DatabaseModule } from '../../database/database.module';
import { CustomerExportService } from './customer-export.service';
import { CustomerExportController } from './customer-export.controller';
import { CustomerExportProcessor } from './customer-export.processor';

@Module({
    imports: [
        PrismaModule,
        DatabaseModule,
        BullModule.registerQueue({ name: 'customer-upload' }),
        BullModule.registerQueue({ name: 'customer-export' }),
    ],
    controllers: [CustomerController, CustomerBulkUploadController, CustomerExportController],
    providers: [
        CustomerService,
        CustomerBulkUploadService,
        CustomerUploadProcessor,
        CustomerCsvParserService,
        CustomerValidatorService,
        UploadEventsService,
        CustomerExportService,
        CustomerExportProcessor,
    ],
    exports: [CustomerService],
})
export class CustomerModule { }
