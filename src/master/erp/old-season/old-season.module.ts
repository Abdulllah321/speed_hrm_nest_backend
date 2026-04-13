import { Module } from '@nestjs/common';
import { OldSeasonService } from './old-season.service';
import { OldSeasonController } from './old-season.controller';
import { ActivityLogsModule } from '../../../activity-logs/activity-logs.module';

@Module({
  imports: [ActivityLogsModule],
  controllers: [OldSeasonController],
  providers: [OldSeasonService],
  exports: [OldSeasonService],
})
export class OldSeasonModule {}
