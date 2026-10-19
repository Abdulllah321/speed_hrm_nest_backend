import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ImportHistoryController } from './import-history.controller';
import { ImportHistoryService } from './import-history.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ImportHistoryController],
  providers: [ImportHistoryService],
  exports: [ImportHistoryService],
})
export class ImportHistoryModule {}
