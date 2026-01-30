import { Module } from '@nestjs/common';
import { AllocationService } from './allocation.service';
import { AllocationController } from './allocation.controller';
import { ActivityLogsModule } from '../../activity-logs/activity-logs.module';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [ActivityLogsModule, DatabaseModule],
  controllers: [AllocationController],
  providers: [AllocationService],
  exports: [AllocationService],
})
export class AllocationModule {}
