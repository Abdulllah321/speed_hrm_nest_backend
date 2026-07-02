import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PosSalesController } from './pos-sales.controller';
import { PosSalesService } from './pos-sales.service';
import { SalesHistoryBulkUploadController } from './sales-history-bulk-upload.controller';
import { SalesHistoryBulkUploadService } from './sales-history-bulk-upload.service';
import { SalesHistoryUploadProcessor } from '../queue/processors/sales-history-upload.processor';
import { SalesHistoryCsvParserService } from '../common/services/sales-history-csv-parser.service';
import { SalesHistoryValidatorService } from '../common/services/sales-history-validator.service';
import { UploadEventsService } from '../finance/item/upload-events.service';
import { DatabaseModule } from '../database/database.module';
import { StockLedgerModule } from '../warehouse/stock-ledger/stock-ledger.module';
import { FbrService } from './fbr.service';
import { CustomerModule } from '../sales/customer/customer.module';
import { PosConfigModule } from '../pos-config/pos-config.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ExportHistoryModule } from '../warehouse/export-history/export-history.module';
import { UploadModule } from '../upload/upload.module';
import { NetSalesSummaryExportService } from './net-sales-summary-export.service';
import { NetSalesSummaryExportProcessor } from './net-sales-summary-export.processor';

@Module({
    imports: [
        DatabaseModule,
        StockLedgerModule,
        CustomerModule,
        PosConfigModule,
        NotificationsModule,
        ExportHistoryModule,
        UploadModule,
        BullModule.registerQueue(
            { name: 'sales-history-upload' },
            { name: 'net-sales-summary-export' }
        ),
    ],
    controllers: [PosSalesController, SalesHistoryBulkUploadController],
    providers: [
        PosSalesService,
        FbrService,
        SalesHistoryBulkUploadService,
        SalesHistoryUploadProcessor,
        SalesHistoryCsvParserService,
        SalesHistoryValidatorService,
        UploadEventsService,
        NetSalesSummaryExportService,
        NetSalesSummaryExportProcessor,
    ],
    exports: [PosSalesService, NetSalesSummaryExportService],
})
export class PosSalesModule { }

