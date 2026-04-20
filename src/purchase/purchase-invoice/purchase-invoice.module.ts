import { Module } from '@nestjs/common';
import { PurchaseInvoiceController } from './purchase-invoice.controller';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AccountingModule } from '../../finance/accounting/accounting.module';
import { StockLedgerModule } from '../../warehouse/stock-ledger/stock-ledger.module';
import { FinanceAccountConfigModule } from '../../finance/finance-account-config/finance-account-config.module';

@Module({
  imports: [PrismaModule, AccountingModule, StockLedgerModule, FinanceAccountConfigModule],
  controllers: [PurchaseInvoiceController],
  providers: [PurchaseInvoiceService],
  exports: [PurchaseInvoiceService],
})
export class PurchaseInvoiceModule {}