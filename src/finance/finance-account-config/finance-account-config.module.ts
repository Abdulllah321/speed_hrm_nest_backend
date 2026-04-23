import { Module } from '@nestjs/common';
import { FinanceAccountConfigController } from './finance-account-config.controller';
import { FinanceAccountConfigService } from './finance-account-config.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [FinanceAccountConfigController],
  providers: [FinanceAccountConfigService],
  exports: [FinanceAccountConfigService],
})
export class FinanceAccountConfigModule {}
