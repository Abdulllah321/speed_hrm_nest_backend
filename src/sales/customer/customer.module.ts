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

@Module({
    imports: [
        PrismaModule,
        DatabaseModule,
        BullModule.registerQueue({ name: 'customer-upload' }),
    ],
    controllers: [CustomerController, CustomerBulkUploadController],
    providers: [
        CustomerService,
        CustomerBulkUploadService,
        CustomerUploadProcessor,
        CustomerCsvParserService,
        CustomerValidatorService,
        UploadEventsService,
    ],
    exports: [CustomerService],
})
export class CustomerModule { }
