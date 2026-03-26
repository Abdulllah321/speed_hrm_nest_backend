import { Module } from '@nestjs/common';
import { JournalVoucherService } from './journal-voucher.service';
import { JournalVoucherController } from './journal-voucher.controller';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [JournalVoucherController],
  providers: [JournalVoucherService],
})
export class JournalVoucherModule {}
