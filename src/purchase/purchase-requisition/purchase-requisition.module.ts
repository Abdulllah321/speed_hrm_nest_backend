import { Module } from '@nestjs/common';
import { PurchaseRequisitionService } from './purchase-requisition.service';
import { PurchaseRequisitionController } from './purchase-requisition.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PurchaseRequisitionController],
  providers: [PurchaseRequisitionService],
  exports: [PurchaseRequisitionService],
})
export class PurchaseRequisitionModule {}
