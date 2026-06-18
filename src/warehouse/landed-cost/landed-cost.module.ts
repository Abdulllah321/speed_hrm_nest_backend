import { Module } from '@nestjs/common';
import { LandedCostService } from './landed-cost.service';
import { LandedCostController } from './landed-cost.controller';
import { StockLedgerModule } from '../stock-ledger/stock-ledger.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { BullModule } from '@nestjs/bull';
import { NotificationsModule } from '../../notifications/notifications.module';
import { LandedCostExportController } from './landed-cost-export.controller';
import { LandedCostExportService } from './landed-cost-export.service';
import { LandedCostExportProcessor } from './landed-cost-export.processor';

@Module({
  imports: [
    PrismaModule,
    StockLedgerModule,
    NotificationsModule,
    BullModule.registerQueue({
      name: 'landed-cost-export',
    }),
  ],
  controllers: [LandedCostController, LandedCostExportController],
  providers: [
    LandedCostService,
    LandedCostExportService,
    LandedCostExportProcessor,
  ],
  exports: [LandedCostService, LandedCostExportService],
})
export class LandedCostModule {}

