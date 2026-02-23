import { Module } from '@nestjs/common';
import { ReceiptVoucherService } from './receipt-voucher.service';
import { ReceiptVoucherController } from './receipt-voucher.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ReceiptVoucherController],
  providers: [ReceiptVoucherService],
})
export class ReceiptVoucherModule {}
