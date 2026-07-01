import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ExportHistoryController } from './export-history.controller';
import { ExportHistoryService } from './export-history.service';
import { UploadModule } from '../../upload/upload.module';

@Module({
  imports: [DatabaseModule, UploadModule],
  controllers: [ExportHistoryController],
  providers: [ExportHistoryService],
  exports: [ExportHistoryService],
})
export class ExportHistoryModule {}
