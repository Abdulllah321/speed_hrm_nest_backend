import { Module } from '@nestjs/common';
import { SalePoolService } from './sale-pool.service';
import { SalePoolController } from './sale-pool.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SalePoolController],
  providers: [SalePoolService],
})
export class SalePoolModule {}
