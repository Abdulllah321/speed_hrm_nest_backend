import { Module } from '@nestjs/common';
import { PosSessionService } from './pos-session.service';
import { PosSessionController } from './pos-session.controller';
import { JournalVoucherModule } from '../finance/journal-voucher/journal-voucher.module';
import { BullModule } from '@nestjs/bull';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReconciliationExportProcessor } from './reconciliation-export.processor';

@Module({
  imports: [
    JournalVoucherModule,
    NotificationsModule,
    BullModule.registerQueue({
      name: 'reconciliation-export',
    }),
  ],
  providers: [PosSessionService, ReconciliationExportProcessor],
  controllers: [PosSessionController],
  exports: [PosSessionService],
})
export class PosSessionModule { }
