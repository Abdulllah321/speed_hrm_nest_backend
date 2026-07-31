import { Module, forwardRef } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';
import { CprService } from './cpr.service';
import { CprController } from './cpr.controller';
import { CprTaxExportController } from './cpr-export.controller';
import { CprTaxExportService } from './cpr-export.service';
import { CprTaxExportProcessor } from './cpr-export.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { DatabaseModule } from '../database/database.module';
import { EOBIModule } from '../eobi/eobi.module';
import { BullModule } from '@nestjs/bull';
import { NotificationsModule } from '../notifications/notifications.module';
import { ExportHistoryModule } from '../warehouse/export-history/export-history.module';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [
    PrismaModule,
    ActivityLogsModule,
    DatabaseModule,
    NotificationsModule,
    ExportHistoryModule,
    UploadModule,
    BullModule.registerQueue({
      name: 'cpr-tax-export',
    }),
    forwardRef(() => EOBIModule),
  ],
  controllers: [PayrollController, CprController, CprTaxExportController],
  providers: [PayrollService, CprService, CprTaxExportService, CprTaxExportProcessor],
  exports: [PayrollService, CprService, CprTaxExportService],
})
export class PayrollModule {}

