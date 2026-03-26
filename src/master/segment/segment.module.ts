import { Module } from '@nestjs/common';
import { SegmentService } from './segment.service';
import { SegmentController } from './segment.controller';
import { ActivityLogsModule } from '../../activity-logs/activity-logs.module';

@Module({
  imports: [ActivityLogsModule],
  controllers: [SegmentController],
  providers: [SegmentService],
  exports: [SegmentService],
})
export class SegmentModule {}
