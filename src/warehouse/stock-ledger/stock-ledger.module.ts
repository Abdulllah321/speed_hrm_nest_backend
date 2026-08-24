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
import { OverallAvailableReservedStockExportService } from './overall-available-reserved-stock-export.service';
import { OverallAvailableReservedStockExportProcessor } from './overall-available-reserved-stock-export.processor';
import { InventoryAgingExportService } from './inventory-aging-export.service';
import { InventoryAgingExportProcessor } from './inventory-aging-export.processor';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { ExportHistoryModule } from '../export-history/export-history.module';
import { UploadModule } from '../../upload/upload.module';

import { FiscalYearClosingService } from './fiscal-year-closing.service';
import { FiscalYearClosingCron } from './fiscal-year-closing.cron';

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
      { name: 'overall-available-reserved-stock-export' },
      { name: 'inventory-aging-export' },
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
    OverallAvailableReservedStockExportService,
    OverallAvailableReservedStockExportProcessor,
    InventoryAgingExportService,
    InventoryAgingExportProcessor,
    FiscalYearClosingService,
    FiscalYearClosingCron,
  ],
  exports: [
    StockLedgerService,
    StockActivityExportService,
    StockValuationExportService,
    StockTransactionDetailExportService,
    AvailableStockSummaryExportService,
    OverallAvailableReservedStockExportService,
    InventoryAgingExportService,
    FiscalYearClosingService,
  ],
})
export class StockLedgerModule {}

