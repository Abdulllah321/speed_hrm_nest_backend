import { Module } from '@nestjs/common';
import { PaymentVoucherService } from './payment-voucher.service';
import { PaymentVoucherController } from './payment-voucher.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [PrismaModule, AccountingModule],
  controllers: [PaymentVoucherController],
  providers: [PaymentVoucherService],
})
export class PaymentVoucherModule {}
