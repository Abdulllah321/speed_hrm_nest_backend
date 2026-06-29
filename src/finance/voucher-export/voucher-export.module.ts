import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DatabaseModule } from '../../database/database.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { VoucherExportService } from './voucher-export.service';
import {
  JournalVoucherExportController,
  PaymentVoucherExportController,
  ReceiptVoucherExportController,
} from './voucher-export.controller';
import { JournalVoucherExportProcessor } from './journal-voucher-export.processor';
import { PaymentVoucherExportProcessor } from './payment-voucher-export.processor';
import { ReceiptVoucherExportProcessor } from './receipt-voucher-export.processor';

@Module({
  imports: [
    DatabaseModule,
    NotificationsModule,
    BullModule.registerQueue(
      { name: 'journal-voucher-export' },
      { name: 'payment-voucher-export' },
      { name: 'receipt-voucher-export' },
    ),
  ],
  controllers: [
    JournalVoucherExportController,
    PaymentVoucherExportController,
    ReceiptVoucherExportController,
  ],
  providers: [
    VoucherExportService,
    JournalVoucherExportProcessor,
    PaymentVoucherExportProcessor,
    ReceiptVoucherExportProcessor,
  ],
})
export class VoucherExportModule {}
