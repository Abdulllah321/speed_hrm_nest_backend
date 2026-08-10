import { Module } from '@nestjs/common';
import { SalesReturnService } from './sales-return.service';
import { SalesReturnController } from './sales-return.controller';
import { CreditNoteService } from '../credit-note/credit-note.service';
import { CreditNoteController } from '../credit-note/credit-note.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { ActivityLogsModule } from '../../activity-logs/activity-logs.module';
import { FinanceAccountConfigModule } from '../../finance/finance-account-config/finance-account-config.module';
import { AccountingModule } from '../../finance/accounting/accounting.module';
import { JournalVoucherModule } from '../../finance/journal-voucher/journal-voucher.module';

@Module({
  imports: [
    PrismaModule,
    ActivityLogsModule,
    FinanceAccountConfigModule,
    AccountingModule,
    JournalVoucherModule,
  ],
  controllers: [SalesReturnController, CreditNoteController],
  providers: [SalesReturnService, CreditNoteService],
  exports: [SalesReturnService, CreditNoteService],
})
export class SalesReturnModule {}
