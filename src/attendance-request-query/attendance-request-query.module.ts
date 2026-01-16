import { Module } from '@nestjs/common';
import { AttendanceRequestQueryController } from './attendance-request-query.controller';
import { AttendanceRequestQueryService } from './attendance-request-query.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';

@Module({
  imports: [PrismaModule, ActivityLogsModule],
  controllers: [AttendanceRequestQueryController],
  providers: [AttendanceRequestQueryService],
  exports: [AttendanceRequestQueryService],
})
export class AttendanceRequestQueryModule {}
