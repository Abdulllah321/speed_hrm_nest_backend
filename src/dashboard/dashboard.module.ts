import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { PosDashboardController } from './pos-dashboard.controller';
import { PosDashboardService } from './pos-dashboard.service';
import { PrismaModule } from '../prisma/prisma.module';
import { TaskReportsModule } from '../task-reports/task-reports.module';

@Module({
  imports: [PrismaModule, TaskReportsModule],
  controllers: [DashboardController, PosDashboardController],
  providers: [DashboardService, PosDashboardService],
})
export class DashboardModule {}
