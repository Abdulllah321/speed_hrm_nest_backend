import { Module } from '@nestjs/common';
import { ItemClassService } from './item-class.service';
import { ItemClassController } from './item-class.controller';
import { ActivityLogsModule } from '../../../activity-logs/activity-logs.module';

@Module({
  imports: [ActivityLogsModule],
  controllers: [ItemClassController],
  providers: [ItemClassService],
  exports: [ItemClassService],
})
export class ItemClassModule {}
