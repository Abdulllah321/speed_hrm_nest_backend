import { Module } from '@nestjs/common';
import { PurchaseInvoiceController } from './purchase-invoice.controller';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PurchaseInvoiceController],
  providers: [PurchaseInvoiceService],
  exports: [PurchaseInvoiceService],
})
export class PurchaseInvoiceModule {}