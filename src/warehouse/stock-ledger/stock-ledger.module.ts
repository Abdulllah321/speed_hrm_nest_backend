import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { StockLedgerService } from './stock-ledger.service';
import { StockLedgerController } from './stock-ledger.controller';
import { StockLedgerExportProcessor } from './stock-ledger-export.processor';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    BullModule.registerQueue(
      { name: 'stock-ledger-export' },
    ),
  ],
  controllers: [StockLedgerController],
  providers: [
    StockLedgerService,
    StockLedgerExportProcessor,
  ],
  exports: [StockLedgerService],
})
export class StockLedgerModule {}
