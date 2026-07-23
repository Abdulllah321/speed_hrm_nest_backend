import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PosClaimsController } from './pos-claims.controller';
import { PosClaimsService } from './pos-claims.service';
import { DatabaseModule } from '../database/database.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { StockLedgerModule } from '../warehouse/stock-ledger/stock-ledger.module';
import { ExportHistoryModule } from '../warehouse/export-history/export-history.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UploadModule } from '../upload/upload.module';
import { ClaimRegisterExportService } from './claim-register-export.service';
import { ClaimRegisterExportProcessor } from './claim-register-export.processor';

@Module({
  imports: [
    DatabaseModule,
    WarehouseModule,
    StockLedgerModule,
    ExportHistoryModule,
    NotificationsModule,
    UploadModule,
    BullModule.registerQueue({
      name: 'claim-register-export',
    }),
  ],
  controllers: [PosClaimsController],
  providers: [
    PosClaimsService,
    ClaimRegisterExportService,
    ClaimRegisterExportProcessor,
  ],
  exports: [PosClaimsService, ClaimRegisterExportService],
})
export class PosClaimsModule {}
