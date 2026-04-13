import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { PrismaModule } from '../prisma/prisma.module';
import { TaskReportsModule } from '../task-reports/task-reports.module';

@Module({
  imports: [PrismaModule, TaskReportsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
