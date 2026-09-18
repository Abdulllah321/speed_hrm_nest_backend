import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { SalesOrderController } from './controllers/sales-order.controller';
import { SalesInvoiceController } from './controllers/sales-invoice.controller';
import { SalesInvoiceExportController } from './controllers/sales-invoice-export.controller';
import { DeliveryChallanController } from './controllers/delivery-challan.controller';
import { EzcommerceOrderController } from './controllers/ezcommerce-order.controller';
import { SalesOrderService } from './services/sales-order.service';
import { SalesInvoiceService } from './services/sales-invoice.service';
import { SalesInvoiceExportService } from './services/sales-invoice-export.service';
import { SalesInvoiceExportProcessor } from './services/sales-invoice-export.processor';
import { DeliveryChallanService } from './services/delivery-challan.service';
import { EzcommerceOrderService } from './services/ezcommerce-order.service';
import { WholesaleInvoiceRegisterController } from './controllers/wholesale-invoice-register.controller';
import { WholesaleInvoiceRegisterService } from './services/wholesale-invoice-register.service';
import { WholesaleInvoiceRegisterProcessor } from './services/wholesale-invoice-register.processor';
import { WholesaleReturnRegisterController } from './controllers/wholesale-return-register.controller';
import { WholesaleReturnRegisterService } from './services/wholesale-return-register.service';
import { WholesaleReturnRegisterProcessor } from './services/wholesale-return-register.processor';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { EncryptionService } from '../common/utils/encryption.service';
import { StockLedgerModule } from '../warehouse/stock-ledger/stock-ledger.module';
import { FinanceAccountConfigModule } from '../finance/finance-account-config/finance-account-config.module';
import { PosSalesModule } from '../pos-sales/pos-sales.module';
import { SalesReturnModule } from './sales-return/sales-return.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ExportHistoryModule } from '../warehouse/export-history/export-history.module';

@Module({
  imports: [
    FinanceAccountConfigModule,
    StockLedgerModule,
    SalesReturnModule,
    PosSalesModule,
    NotificationsModule,
    ExportHistoryModule,
    BullModule.registerQueue({
      name: 'sales-invoice-export',
    }),
  ],
  controllers: [
    SalesOrderController,
    SalesInvoiceController,
    SalesInvoiceExportController,
    DeliveryChallanController,
    EzcommerceOrderController,
    WholesaleInvoiceRegisterController,
    WholesaleReturnRegisterController,
  ],
  providers: [
    SalesOrderService,
    SalesInvoiceService,
    SalesInvoiceExportService,
    SalesInvoiceExportProcessor,
    DeliveryChallanService,
    EzcommerceOrderService,
    WholesaleInvoiceRegisterService,
    WholesaleInvoiceRegisterProcessor,
    WholesaleReturnRegisterService,
    WholesaleReturnRegisterProcessor,
    PrismaService,
    PrismaMasterService,
    EncryptionService,
  ],
  exports: [
    SalesOrderService,
    SalesInvoiceService,
    DeliveryChallanService,
    EzcommerceOrderService,
  ],
})
export class SalesModule {}
