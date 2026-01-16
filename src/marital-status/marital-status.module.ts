import { Module } from '@nestjs/common';
import { MaritalStatusController } from './marital-status.controller';
import { MaritalStatusService } from './marital-status.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';

@Module({
  imports: [PrismaModule, ActivityLogsModule],
  controllers: [MaritalStatusController],
  providers: [MaritalStatusService],
})
export class MaritalStatusModule {}
