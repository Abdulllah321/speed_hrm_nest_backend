import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';
import { TaskDueReminderProcessor } from './task-due-reminder.processor';
import { TaskDueReminderScheduler } from './task-due-reminder.scheduler';
import { DatabaseModule } from '../database/database.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { UploadModule } from '../upload/upload.module';
import { KpiModule } from '../kpi/kpi.module';

@Module({
  imports: [
    DatabaseModule,
    ActivityLogsModule,
    UploadModule,
    KpiModule,
    BullModule.registerQueue({ name: 'task-due-reminder' }),
  ],
  controllers: [TaskController],
  providers: [TaskService, TaskDueReminderProcessor, TaskDueReminderScheduler],
  exports: [TaskService],
})
export class TaskModule {}
