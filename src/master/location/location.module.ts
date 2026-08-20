import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { LocationController } from './location.controller';
import { LocationService } from './location.service';
import { LocationExportController } from './location-export.controller';
import { LocationExportService } from './location-export.service';
import { LocationExportProcessor } from './location-export.processor';
import { PrismaModule } from '../../prisma/prisma.module';
import { DatabaseModule } from '../../database/database.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { ActivityLogsModule } from '../../activity-logs/activity-logs.module';

@Module({
  imports: [
    PrismaModule,
    DatabaseModule,
    NotificationsModule,
    ActivityLogsModule,
    BullModule.registerQueue({
      name: 'location-export',
    }),
  ],
  controllers: [LocationController, LocationExportController],
  providers: [LocationService, LocationExportService, LocationExportProcessor],
  exports: [LocationService, LocationExportService],
})
export class LocationModule {}

