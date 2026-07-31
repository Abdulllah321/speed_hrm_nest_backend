import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { LoanRequestController } from './loan-request.controller';
import { LoanRequestService } from './loan-request.service';
import { LoanRequestExportController } from './loan-request-export.controller';
import { LoanRequestExportService } from './loan-request-export.service';
import { LoanRequestExportProcessor } from './loan-request-export.processor';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { DatabaseModule } from '../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ExportHistoryModule } from '../warehouse/export-history/export-history.module';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [
    DatabaseModule,
    ActivityLogsModule,
    NotificationsModule,
    ExportHistoryModule,
    UploadModule,
    BullModule.registerQueue({ name: 'loan-request-export' }),
  ],
  controllers: [LoanRequestController, LoanRequestExportController],
  providers: [LoanRequestService, LoanRequestExportService, LoanRequestExportProcessor],
  exports: [LoanRequestService],
})
export class LoanRequestModule {}
