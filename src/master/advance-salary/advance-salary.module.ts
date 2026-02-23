import { Module } from '@nestjs/common';
import { AdvanceSalaryController } from './advance-salary.controller';
import { AdvanceSalaryService } from './advance-salary.service';
import { ActivityLogsModule } from '../../activity-logs/activity-logs.module';
import { DatabaseModule } from '../../database/database.module';
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
  imports: [ActivityLogsModule, DatabaseModule, NotificationsModule],
  controllers: [AdvanceSalaryController],
  providers: [AdvanceSalaryService],
  exports: [AdvanceSalaryService],
})
export class AdvanceSalaryModule {}
