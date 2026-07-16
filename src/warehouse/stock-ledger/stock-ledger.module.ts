import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { StockLedgerService } from './stock-ledger.service';
import { StockLedgerController } from './stock-ledger.controller';
import { StockLedgerExportProcessor } from './stock-ledger-export.processor';
import { StockActivityExportService } from './stock-activity-export.service';
import { StockActivityExportProcessor } from './stock-activity-export.processor';
import { StockValuationExportService } from './stock-valuation-export.service';
import { StockValuationExportProcessor } from './stock-valuation-export.processor';
import { StockTransactionDetailExportService } from './stock-transaction-detail-export.service';
import { StockTransactionDetailExportProcessor } from './stock-transaction-detail-export.processor';
import { AvailableStockSummaryExportService } from './available-stock-summary-export.service';
import { AvailableStockSummaryExportProcessor } from './available-stock-summary-export.processor';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { ExportHistoryModule } from '../export-history/export-history.module';
import { UploadModule } from '../../upload/upload.module';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    ExportHistoryModule,
    UploadModule,
    BullModule.registerQueue(
      { name: 'stock-ledger-export' },
      { name: 'stock-activity-export' },
      { name: 'stock-valuation-export' },
      { name: 'stock-transaction-detail-export' },
      { name: 'available-stock-summary-export' },
    ),
  ],
  controllers: [StockLedgerController],
  providers: [
    StockLedgerService,
    StockLedgerExportProcessor,
    StockActivityExportService,
    StockActivityExportProcessor,
    StockValuationExportService,
    StockValuationExportProcessor,
    StockTransactionDetailExportService,
    StockTransactionDetailExportProcessor,
    AvailableStockSummaryExportService,
    AvailableStockSummaryExportProcessor,
  ],
  exports: [
    StockLedgerService,
    StockActivityExportService,
    StockValuationExportService,
    StockTransactionDetailExportService,
    AvailableStockSummaryExportService,
  ],
})
export class StockLedgerModule {}

