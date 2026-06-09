import { Module } from '@nestjs/common';
import { PosSessionService } from './pos-session.service';
import { PosSessionController } from './pos-session.controller';
import { JournalVoucherModule } from '../finance/journal-voucher/journal-voucher.module';

@Module({
  imports: [JournalVoucherModule],
  providers: [PosSessionService],
  controllers: [PosSessionController],
  exports: [PosSessionService],
})
export class PosSessionModule { }
