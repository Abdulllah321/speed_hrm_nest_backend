import { Module } from '@nestjs/common';
import { ChartOfAccountService } from './chart-of-account.service';
import { ChartOfAccountController } from './chart-of-account.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ChartOfAccountController],
  providers: [ChartOfAccountService],
  exports: [ChartOfAccountService],
})
export class ChartOfAccountModule {}
