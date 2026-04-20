import { Module } from '@nestjs/common';
import { PaymentVoucherService } from './payment-voucher.service';
import { PaymentVoucherController } from './payment-voucher.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { FinanceAccountConfigModule } from '../finance-account-config/finance-account-config.module';

@Module({
  imports: [PrismaModule, AccountingModule, FinanceAccountConfigModule],
  controllers: [PaymentVoucherController],
  providers: [PaymentVoucherService],
})
export class PaymentVoucherModule {}
