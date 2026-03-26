import { Module } from '@nestjs/common';
import { PurchaseReturnService } from './purchase-return.service';
import { PurchaseReturnController } from './purchase-return.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PurchaseReturnController],
  providers: [PurchaseReturnService],
  exports: [PurchaseReturnService],
})
export class PurchaseReturnModule {}