import { Module } from '@nestjs/common';
import { SalesOrderController } from './controllers/sales-order.controller';
import { SalesInvoiceController } from './controllers/sales-invoice.controller';
import { DeliveryChallanController } from './controllers/delivery-challan.controller';
import { EzcommerceOrderController } from './controllers/ezcommerce-order.controller';
import { SalesOrderService } from './services/sales-order.service';
import { SalesInvoiceService } from './services/sales-invoice.service';
import { DeliveryChallanService } from './services/delivery-challan.service';
import { EzcommerceOrderService } from './services/ezcommerce-order.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockLedgerModule } from '../warehouse/stock-ledger/stock-ledger.module';
import { FinanceAccountConfigModule } from '../finance/finance-account-config/finance-account-config.module';

@Module({
  imports: [FinanceAccountConfigModule, StockLedgerModule],
  controllers: [
    SalesOrderController,
    SalesInvoiceController,
    DeliveryChallanController,
    EzcommerceOrderController,
  ],
  providers: [
    SalesOrderService,
    SalesInvoiceService,
    DeliveryChallanService,
    EzcommerceOrderService,
    PrismaService,
  ],
  exports: [
    SalesOrderService,
    SalesInvoiceService,
    DeliveryChallanService,
    EzcommerceOrderService,
  ],
})
export class SalesModule {}