import { Module } from '@nestjs/common'
import { AttendanceExemptionController } from './attendance-exemption.controller'
import { AttendanceExemptionService } from './attendance-exemption.service'
import { PrismaModule } from '../prisma/prisma.module'
import { ActivityLogsModule } from '../activity-logs/activity-logs.module'

@Module({
  imports: [PrismaModule, ActivityLogsModule],
  controllers: [AttendanceExemptionController],
  providers: [AttendanceExemptionService],
  exports: [AttendanceExemptionService],
})
export class AttendanceExemptionModule {}

