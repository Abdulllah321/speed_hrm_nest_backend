import { Module } from '@nestjs/common';
import { SalesOrderController } from './controllers/sales-order.controller';
import { SalesInvoiceController } from './controllers/sales-invoice.controller';
import { DeliveryChallanController } from './controllers/delivery-challan.controller';
import { SalesOrderService } from './services/sales-order.service';
import { SalesInvoiceService } from './services/sales-invoice.service';
import { DeliveryChallanService } from './services/delivery-challan.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockLedgerModule } from '../warehouse/stock-ledger/stock-ledger.module';
import { FinanceAccountConfigModule } from '../finance/finance-account-config/finance-account-config.module';

@Module({
  imports: [FinanceAccountConfigModule, StockLedgerModule],
  controllers: [
    SalesOrderController,
    SalesInvoiceController,
    DeliveryChallanController,
  ],
  providers: [
    SalesOrderService,
    SalesInvoiceService,
    DeliveryChallanService,
    PrismaService,
  ],
  exports: [
    SalesOrderService,
    SalesInvoiceService,
    DeliveryChallanService,
  ],
})
export class SalesModule {}