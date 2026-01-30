import { Module } from '@nestjs/common';
import { LoanRequestController } from './loan-request.controller';
import { LoanRequestService } from './loan-request.service';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule, ActivityLogsModule],
  controllers: [LoanRequestController],
  providers: [LoanRequestService],
  exports: [LoanRequestService],
})
export class LoanRequestModule {}
