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
import { PosSalesActivityExportController } from './pos-sales-activity-export.controller';
import { PosSalesActivityExportService } from './pos-sales-activity-export.service';
import { PosSalesActivityExportProcessor } from './pos-sales-activity-export.processor';
import { SalesRegisterExportService } from './sales-register-export.service';
import { SalesRegisterExportProcessor } from './sales-register-export.processor';
import { SalesListExportService } from './sales-list-export.service';
import { SalesListExportProcessor } from './sales-list-export.processor';
import { GrossSalesExportService } from './gross-sales-export.service';
import { GrossSalesExportProcessor } from './gross-sales-export.processor';
import { AllianceRegisterExportService } from './alliance-register-export.service';
import { AllianceRegisterExportProcessor } from './alliance-register-export.processor';
import { CostOfSalesExportService } from './cost-of-sales-export.service';
import { CostOfSalesExportProcessor } from './cost-of-sales-export.processor';
import { GiftVoucherSaleRegisterExportService } from './gift-voucher-sale-register-export.service';
import { GiftVoucherSaleRegisterExportProcessor } from './gift-voucher-sale-register-export.processor';
import { CorporateVoucherExportService } from './corporate-voucher-export.service';
import { CorporateVoucherExportProcessor } from './corporate-voucher-export.processor';
import { CreditVoucherExportService } from './credit-voucher-export.service';
import { CreditVoucherExportProcessor } from './credit-voucher-export.processor';
import { WarehouseModule } from '../warehouse/warehouse.module';

@Module({
    imports: [
        DatabaseModule,
        StockLedgerModule,
        WarehouseModule,
        CustomerModule,
        PosConfigModule,
        NotificationsModule,
        ExportHistoryModule,
        UploadModule,
        BullModule.registerQueue(
            { name: 'sales-history-upload' },
            { name: 'net-sales-summary-export' },
            { name: 'pos-sales-activity-export' },
            { name: 'sales-register-export' },
            { name: 'sales-list-export' },
            { name: 'gross-sales-export' },
            { name: 'alliance-register-export' },
            { name: 'cost-of-sales-export' },
            { name: 'gift-voucher-sale-register-export' },
            { name: 'corporate-voucher-export' },
            { name: 'credit-voucher-export' }
        ),
    ],
    controllers: [
        PosSalesController, 
        SalesHistoryBulkUploadController,
        PosSalesActivityExportController,
    ],
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
        PosSalesActivityExportService,
        PosSalesActivityExportProcessor,
        SalesRegisterExportService,
        SalesRegisterExportProcessor,
        SalesListExportService,
        SalesListExportProcessor,
        GrossSalesExportService,
        GrossSalesExportProcessor,
        AllianceRegisterExportService,
        AllianceRegisterExportProcessor,
        CostOfSalesExportService,
        CostOfSalesExportProcessor,
        GiftVoucherSaleRegisterExportService,
        GiftVoucherSaleRegisterExportProcessor,
        CorporateVoucherExportService,
        CorporateVoucherExportProcessor,
        CreditVoucherExportService,
        CreditVoucherExportProcessor,
    ],
    exports: [
        PosSalesService, 
        NetSalesSummaryExportService,
        PosSalesActivityExportService,
        SalesRegisterExportService,
        SalesListExportService,
        GrossSalesExportService,
        AllianceRegisterExportService,
        CostOfSalesExportService,
        GiftVoucherSaleRegisterExportService,
        CorporateVoucherExportService,
        CreditVoucherExportService,
    ],
})
export class PosSalesModule { }
