import { Module } from '@nestjs/common';
import { AllowanceController } from './allowance.controller';
import { AllowanceService } from './allowance.service';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [ActivityLogsModule, DatabaseModule],
  controllers: [AllowanceController],
  providers: [AllowanceService],
  exports: [AllowanceService],
})
export class AllowanceModule {}
