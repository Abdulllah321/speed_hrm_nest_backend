import { Module } from '@nestjs/common';
import { ValuationService } from './valuation.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [ValuationService],
  exports: [ValuationService],
})
export class InventoryModule {}
