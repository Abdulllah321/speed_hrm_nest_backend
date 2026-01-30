import { Module } from '@nestjs/common';
import { LeaveApplicationController } from './leave-application.controller';
import { LeaveApplicationService } from './leave-application.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DatabaseModule } from '../database/database.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    PrismaModule,
    DatabaseModule,
    ActivityLogsModule,
    NotificationsModule,
  ],
  controllers: [LeaveApplicationController],
  providers: [LeaveApplicationService],
})
export class LeaveApplicationModule {}
