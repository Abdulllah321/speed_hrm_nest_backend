import { Module } from '@nestjs/common';
import { AttendanceExemptionController } from './attendance-exemption.controller';
import { AttendanceExemptionService } from './attendance-exemption.service';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [ActivityLogsModule, DatabaseModule],
  controllers: [AttendanceExemptionController],
  providers: [AttendanceExemptionService],
  exports: [AttendanceExemptionService],
})
export class AttendanceExemptionModule {}
