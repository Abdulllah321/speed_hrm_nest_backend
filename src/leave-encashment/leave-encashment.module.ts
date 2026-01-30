import { Module } from '@nestjs/common';
import { LeaveEncashmentController } from './leave-encashment.controller';
import { LeaveEncashmentService } from './leave-encashment.service';
import { DatabaseModule } from '../database/database.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';

@Module({
  imports: [DatabaseModule, ActivityLogsModule],
  controllers: [LeaveEncashmentController],
  providers: [LeaveEncashmentService],
  exports: [LeaveEncashmentService],
})
export class LeaveEncashmentModule {}
