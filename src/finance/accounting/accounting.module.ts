import { Module } from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { AccountLedgerController } from './account-ledger.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [AccountLedgerController],
    providers: [AccountingService],
    exports: [AccountingService],
})
export class AccountingModule {}
