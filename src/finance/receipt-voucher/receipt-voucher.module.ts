import { Module } from '@nestjs/common';
import { ReceiptVoucherService } from './receipt-voucher.service';
import { ReceiptVoucherController } from './receipt-voucher.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [PrismaModule, AccountingModule],
  controllers: [ReceiptVoucherController],
  providers: [ReceiptVoucherService],
})
export class ReceiptVoucherModule {}
