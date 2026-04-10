import { Module } from '@nestjs/common';
import { KpiController } from './kpi.controller';
import { KpiService } from './kpi.service';
import { KpiComputeService } from './kpi-compute.service';
import { KpiDashboardService } from './kpi-dashboard.service';
import { KpiApprovalService } from './kpi-approval.service';
import { DatabaseModule } from '../database/database.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';

@Module({
  imports: [DatabaseModule, ActivityLogsModule],
  controllers: [KpiController],
  providers: [KpiService, KpiComputeService, KpiDashboardService, KpiApprovalService],
  exports: [KpiService, KpiComputeService, KpiDashboardService, KpiApprovalService],
})
export class KpiModule {}
