import { Module } from '@nestjs/common';
import { TaskProjectController } from './task-project.controller';
import { TaskProjectService } from './task-project.service';
import { DatabaseModule } from '../database/database.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';

@Module({
  imports: [DatabaseModule, ActivityLogsModule],
  controllers: [TaskProjectController],
  providers: [TaskProjectService],
  exports: [TaskProjectService],
})
export class TaskProjectModule {}
