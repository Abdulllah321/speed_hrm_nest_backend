import { Module } from '@nestjs/common';
import { PurchaseReturnService } from './purchase-return.service';
import { PurchaseReturnController } from './purchase-return.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { FinanceAccountConfigModule } from '../../finance/finance-account-config/finance-account-config.module';
import { AccountingModule } from '../../finance/accounting/accounting.module';

@Module({
  imports: [PrismaModule, FinanceAccountConfigModule, AccountingModule],
  controllers: [PurchaseReturnController],
  providers: [PurchaseReturnService],
  exports: [PurchaseReturnService],
})
export class PurchaseReturnModule {}