import { Module } from '@nestjs/common';
import { JournalVoucherService } from './journal-voucher.service';
import { JournalVoucherController } from './journal-voucher.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [JournalVoucherController],
    providers: [JournalVoucherService],
})
export class JournalVoucherModule { }
