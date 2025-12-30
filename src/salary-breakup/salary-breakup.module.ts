import { Module } from '@nestjs/common'
import { SalaryBreakupController } from './salary-breakup.controller'
import { SalaryBreakupService } from './salary-breakup.service'
import { PrismaModule } from '../prisma/prisma.module'
import { ActivityLogsModule } from '../activity-logs/activity-logs.module'

@Module({
  imports: [PrismaModule, ActivityLogsModule],
  controllers: [SalaryBreakupController],
  providers: [SalaryBreakupService],
})
export class SalaryBreakupModule {}
