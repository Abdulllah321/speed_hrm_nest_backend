import { Module } from '@nestjs/common';
import { SalesOrderController } from './controllers/sales-order.controller';
import { SalesInvoiceController } from './controllers/sales-invoice.controller';
import { DeliveryChallanController } from './controllers/delivery-challan.controller';
import { SalesOrderService } from './services/sales-order.service';
import { SalesInvoiceService } from './services/sales-invoice.service';
import { DeliveryChallanService } from './services/delivery-challan.service';

@Module({
  controllers: [
    SalesOrderController,
    SalesInvoiceController,
    DeliveryChallanController,
  ],
  providers: [
    SalesOrderService,
    SalesInvoiceService,
    DeliveryChallanService,
  ],
  exports: [
    SalesOrderService,
    SalesInvoiceService,
    DeliveryChallanService,
  ],
})
export class SalesModule {}