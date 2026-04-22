import { Module } from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { AccountLedgerController } from './account-ledger.controller';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [AccountLedgerController, ReportsController],
    providers: [AccountingService, ReportsService],
    exports: [AccountingService, ReportsService],
})
export class AccountingModule {}
