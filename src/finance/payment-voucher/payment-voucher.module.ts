import { Module } from '@nestjs/common';
import { PaymentVoucherService } from './payment-voucher.service';
import { PaymentVoucherController } from './payment-voucher.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PaymentVoucherController],
  providers: [PaymentVoucherService],
})
export class PaymentVoucherModule {}
