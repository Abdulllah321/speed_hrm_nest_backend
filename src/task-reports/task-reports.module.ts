import { Module } from '@nestjs/common';
import { TaskReportsController } from './task-reports.controller';
import { TaskReportsService } from './task-reports.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [TaskReportsController],
  providers: [TaskReportsService],
  exports: [TaskReportsService],
})
export class TaskReportsModule {}
