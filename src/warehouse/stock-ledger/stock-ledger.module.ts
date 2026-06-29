import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { StockLedgerService } from './stock-ledger.service';
import { StockLedgerController } from './stock-ledger.controller';
import { StockLedgerExportProcessor } from './stock-ledger-export.processor';
import { StockActivityExportService } from './stock-activity-export.service';
import { StockActivityExportProcessor } from './stock-activity-export.processor';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    BullModule.registerQueue(
      { name: 'stock-ledger-export' },
      { name: 'stock-activity-export' },
    ),
  ],
  controllers: [StockLedgerController],
  providers: [
    StockLedgerService,
    StockLedgerExportProcessor,
    StockActivityExportService,
    StockActivityExportProcessor,
  ],
  exports: [StockLedgerService, StockActivityExportService],
})
export class StockLedgerModule {}
