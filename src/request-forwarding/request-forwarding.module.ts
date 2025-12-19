import { Module } from '@nestjs/common';
import { RequestForwardingController } from './request-forwarding.controller';
import { RequestForwardingService } from './request-forwarding.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';

@Module({
  imports: [PrismaModule, ActivityLogsModule],
  controllers: [RequestForwardingController],
  providers: [RequestForwardingService],
  exports: [RequestForwardingService],
})
export class RequestForwardingModule {}
