import { Module } from '@nestjs/common'
import { ExitClearanceController } from './exit-clearance.controller'
import { ExitClearanceService } from './exit-clearance.service'
import { PrismaModule } from '../prisma/prisma.module'
import { ActivityLogsModule } from '../activity-logs/activity-logs.module'

@Module({
  imports: [PrismaModule, ActivityLogsModule],
  controllers: [ExitClearanceController],
  providers: [ExitClearanceService],
})
export class ExitClearanceModule {}

