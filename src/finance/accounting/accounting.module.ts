import { Module } from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { AccountLedgerController } from './account-ledger.controller';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { BullModule } from '@nestjs/bull';
import { NotificationsModule } from '../../notifications/notifications.module';
import { TrialBalanceExportController } from './trial-balance-export.controller';
import { TrialBalanceExportService } from './trial-balance-export.service';
import { TrialBalanceExportProcessor } from './trial-balance-export.processor';

@Module({
    imports: [
        PrismaModule,
        NotificationsModule,
        BullModule.registerQueue({
            name: 'trial-balance-export',
        }),
    ],
    controllers: [
        AccountLedgerController, 
        ReportsController, 
        TrialBalanceExportController,
    ],
    providers: [
        AccountingService, 
        ReportsService,
        TrialBalanceExportService,
        TrialBalanceExportProcessor,
    ],
    exports: [AccountingService, ReportsService, TrialBalanceExportService],
})
export class AccountingModule {}
