import { Module } from '@nestjs/common';
import { OvertimeRequestController } from './overtime-request.controller';
import { OvertimeRequestService } from './overtime-request.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';

@Module({
  imports: [PrismaModule, ActivityLogsModule],
  controllers: [OvertimeRequestController],
  providers: [OvertimeRequestService],
  exports: [OvertimeRequestService],
})
export class OvertimeRequestModule {}
