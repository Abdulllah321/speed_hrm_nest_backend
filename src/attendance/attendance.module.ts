import { Module } from '@nestjs/common'
import { AttendanceController } from './attendance.controller'
import { AttendanceService } from './attendance.service'
import { PrismaModule } from '../prisma/prisma.module'
import { ActivityLogsModule } from '../activity-logs/activity-logs.module'

@Module({
  imports: [PrismaModule, ActivityLogsModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}

