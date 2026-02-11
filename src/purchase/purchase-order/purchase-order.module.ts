import { Module } from '@nestjs/common';
import { PurchaseOrderService } from './purchase-order.service';
import { PurchaseOrderController } from './purchase-order.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [PurchaseOrderController],
    providers: [PurchaseOrderService],
    exports: [PurchaseOrderService]
})
export class PurchaseOrderModule { }
