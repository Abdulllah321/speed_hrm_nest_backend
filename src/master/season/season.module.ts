import { Module } from '@nestjs/common';
import { SeasonService } from './season.service';
import { SeasonController } from './season.controller';
import { ActivityLogsModule } from '../../activity-logs/activity-logs.module';

@Module({
  imports: [ActivityLogsModule],
  controllers: [SeasonController],
  providers: [SeasonService],
  exports: [SeasonService],
})
export class SeasonModule {}
