import { Module } from '@nestjs/common';
import { ItemSubclassService } from './item-subclass.service';
import { ItemSubclassController } from './item-subclass.controller';
import { ActivityLogsModule } from '../../../activity-logs/activity-logs.module';

@Module({
  imports: [ActivityLogsModule],
  controllers: [ItemSubclassController],
  providers: [ItemSubclassService],
  exports: [ItemSubclassService],
})
export class ItemSubclassModule {}
