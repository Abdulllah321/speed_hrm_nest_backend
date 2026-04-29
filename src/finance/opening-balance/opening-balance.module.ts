import { Module } from '@nestjs/common';
import { OpeningBalanceController } from './opening-balance.controller';
import { OpeningBalanceService } from './opening-balance.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [PrismaModule, AccountingModule],
  controllers: [OpeningBalanceController],
  providers: [OpeningBalanceService],
  exports: [OpeningBalanceService],
})
export class OpeningBalanceModule {}
