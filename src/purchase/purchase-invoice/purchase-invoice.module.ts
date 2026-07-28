import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PurchaseInvoiceController } from './purchase-invoice.controller';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { PiRegisterExportService } from './pi-register-export.service';
import { PiRegisterExportProcessor } from './pi-register-export.processor';
import { PrismaModule } from '../../prisma/prisma.module';
import { AccountingModule } from '../../finance/accounting/accounting.module';
import { StockLedgerModule } from '../../warehouse/stock-ledger/stock-ledger.module';
import { FinanceAccountConfigModule } from '../../finance/finance-account-config/finance-account-config.module';
import { UploadModule } from '../../upload/upload.service';
import { ExportHistoryModule } from '../../warehouse/export-history/export-history.module';
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
  imports: [
    PrismaModule,
    AccountingModule,
    StockLedgerModule,
    FinanceAccountConfigModule,
    UploadModule,
    ExportHistoryModule,
    NotificationsModule,
    BullModule.registerQueue({
      name: 'pi-register-export',
    }),
  ],
  controllers: [PurchaseInvoiceController],
  providers: [
    PurchaseInvoiceService,
    PiRegisterExportService,
    PiRegisterExportProcessor,
  ],
  exports: [PurchaseInvoiceService, PiRegisterExportService],
})
export class PurchaseInvoiceModule {}