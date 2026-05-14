import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { SupplierService } from './supplier.service';
import { SupplierController } from './supplier.controller';
import { SupplierExportController } from './supplier-export.controller';
import { SupplierExportService } from './supplier-export.service';
import { SupplierExportProcessor } from './supplier-export.processor';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    BullModule.registerQueue(
      { name: 'supplier-export' },
    ),
  ],
  controllers: [SupplierController, SupplierExportController],
  providers: [
    SupplierService,
    SupplierExportService,
    SupplierExportProcessor,
  ],
  exports: [SupplierService],
})
export class SupplierModule {}
