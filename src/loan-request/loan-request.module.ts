import { Module } from '@nestjs/common';
import { LoanRequestController } from './loan-request.controller';
import { LoanRequestService } from './loan-request.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';

@Module({
  imports: [PrismaModule, ActivityLogsModule],
  controllers: [LoanRequestController],
  providers: [LoanRequestService],
  exports: [LoanRequestService],
})
export class LoanRequestModule {}
