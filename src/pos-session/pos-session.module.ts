import { Module } from '@nestjs/common';
import { PosSessionService } from './pos-session.service';
import { PosSessionController } from './pos-session.controller';
import { JournalVoucherModule } from '../finance/journal-voucher/journal-voucher.module';
import { ReceiptVoucherModule } from '../finance/receipt-voucher/receipt-voucher.module';
import { BullModule } from '@nestjs/bull';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReconciliationExportProcessor } from './reconciliation-export.processor';
import { PosSessionRsrvScheduler } from './pos-session-rsrv.scheduler';
import { PosSessionRsrvProcessor } from './pos-session-rsrv.processor';

@Module({
  imports: [
    JournalVoucherModule,
    ReceiptVoucherModule,
    NotificationsModule,
    BullModule.registerQueue({
      name: 'reconciliation-export',
    }),
    BullModule.registerQueue({
      name: 'reconciliation-rsrv',
    }),
  ],
  providers: [
    PosSessionService,
    ReconciliationExportProcessor,
    PosSessionRsrvScheduler,
    PosSessionRsrvProcessor,
  ],
  controllers: [PosSessionController],
  exports: [PosSessionService],
})
export class PosSessionModule { }

