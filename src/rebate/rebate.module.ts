import { Module } from '@nestjs/common';
import { RebateController } from './rebate.controller';
import { RebateService } from './rebate.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [PrismaModule, ActivityLogsModule, DatabaseModule],
  controllers: [RebateController],
  providers: [RebateService],
  exports: [RebateService],
})
export class RebateModule {}
