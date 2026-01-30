import { Module } from '@nestjs/common';
import { IncrementController } from './increment.controller';
import { IncrementService } from './increment.service';
import { DatabaseModule } from '../database/database.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';

@Module({
  imports: [DatabaseModule, ActivityLogsModule],
  controllers: [IncrementController],
  providers: [IncrementService],
  exports: [IncrementService],
})
export class IncrementModule {}
