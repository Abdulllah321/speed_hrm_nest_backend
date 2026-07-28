import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PurchaseReturnService } from './purchase-return.service';
import { PurchaseReturnController } from './purchase-return.controller';
import { PurchaseReturnRegisterExportService } from './purchase-return-register-export.service';
import { PurchaseReturnRegisterExportProcessor } from './purchase-return-register-export.processor';
import { PrismaModule } from '../../prisma/prisma.module';
import { FinanceAccountConfigModule } from '../../finance/finance-account-config/finance-account-config.module';
import { AccountingModule } from '../../finance/accounting/accounting.module';
import { JournalVoucherModule } from '../../finance/journal-voucher/journal-voucher.module';
import { UploadModule } from '../../upload/upload.module';
import { ExportHistoryModule } from '../../warehouse/export-history/export-history.module';
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
  imports: [
    PrismaModule,
    FinanceAccountConfigModule,
    AccountingModule,
    JournalVoucherModule,
    UploadModule,
    ExportHistoryModule,
    NotificationsModule,
    BullModule.registerQueue({
      name: 'purchase-return-register-export',
    }),
  ],
  controllers: [PurchaseReturnController],
  providers: [
    PurchaseReturnService,
    PurchaseReturnRegisterExportService,
    PurchaseReturnRegisterExportProcessor,
  ],
  exports: [PurchaseReturnService, PurchaseReturnRegisterExportService],
})
export class PurchaseReturnModule {}