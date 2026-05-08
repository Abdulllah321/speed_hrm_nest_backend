import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ChartOfAccountService } from './chart-of-account.service';
import { ChartOfAccountController } from './chart-of-account.controller';
import { CoaBulkUploadController } from './coa-bulk-upload.controller';
import { CoaBulkUploadService } from './coa-bulk-upload.service';
import { CoaUploadProcessor } from '../../queue/processors/coa-upload.processor';
import { CoaCsvParserService } from '../../common/services/coa-csv-parser.service';
import { CoaValidatorService } from '../../common/services/coa-validator.service';
import { UploadEventsService } from '../item/upload-events.service';
import { AccountingModule } from '../accounting/accounting.module';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    AccountingModule,
    BullModule.registerQueue({
      name: 'coa-upload',
    }),
  ],
  controllers: [ChartOfAccountController, CoaBulkUploadController],
  providers: [
    ChartOfAccountService,
    CoaBulkUploadService,
    CoaUploadProcessor,
    CoaCsvParserService,
    CoaValidatorService,
    UploadEventsService,
  ],
  exports: [ChartOfAccountService],
})
export class ChartOfAccountModule {}
