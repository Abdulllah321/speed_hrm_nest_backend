import { Module } from '@nestjs/common';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { DatabaseModule } from '../../database/database.module';
import { ActivityLogsModule } from '../../activity-logs/activity-logs.module';

@Module({
  imports: [DatabaseModule, ActivityLogsModule],
  controllers: [PosController],
  providers: [PosService],
  exports: [PosService],
})
export class PosModule {}
