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
import { NotificationsModule } from '../../notifications/notifications.module';
import { ChartOfAccountExportController } from './chart-of-account-export.controller';
import { ChartOfAccountExportService } from './chart-of-account-export.service';
import { ChartOfAccountExportProcessor } from './chart-of-account-export.processor';

@Module({
  imports: [
    PrismaModule,
    AccountingModule,
    NotificationsModule,
    BullModule.registerQueue(
      { name: 'coa-upload' },
      { name: 'chart-of-account-export' },
    ),
  ],
  controllers: [ChartOfAccountController, CoaBulkUploadController, ChartOfAccountExportController],
  providers: [
    ChartOfAccountService,
    CoaBulkUploadService,
    CoaUploadProcessor,
    CoaCsvParserService,
    CoaValidatorService,
    UploadEventsService,
    ChartOfAccountExportService,
    ChartOfAccountExportProcessor,
  ],
  exports: [ChartOfAccountService],
})
export class ChartOfAccountModule {}
