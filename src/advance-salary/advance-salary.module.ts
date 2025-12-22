import { Module } from '@nestjs/common';
import { AdvanceSalaryController } from './advance-salary.controller';
import { AdvanceSalaryService } from './advance-salary.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';

@Module({
  imports: [PrismaModule, ActivityLogsModule],
  controllers: [AdvanceSalaryController],
  providers: [AdvanceSalaryService],
  exports: [AdvanceSalaryService],
})
export class AdvanceSalaryModule {}
