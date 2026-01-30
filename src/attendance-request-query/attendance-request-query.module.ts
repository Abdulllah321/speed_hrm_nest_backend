import { Module } from '@nestjs/common';
import { AttendanceRequestQueryController } from './attendance-request-query.controller';
import { AttendanceRequestQueryService } from './attendance-request-query.service';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [ActivityLogsModule, DatabaseModule],
  controllers: [AttendanceRequestQueryController],
  providers: [AttendanceRequestQueryService],
  exports: [AttendanceRequestQueryService],
})
export class AttendanceRequestQueryModule {}
