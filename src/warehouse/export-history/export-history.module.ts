import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ExportHistoryController } from './export-history.controller';
import { ExportHistoryService } from './export-history.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ExportHistoryController],
  providers: [ExportHistoryService],
  exports: [ExportHistoryService],
})
export class ExportHistoryModule {}
