import { Module } from '@nestjs/common';
import { AllowanceHeadController } from './allowance-head.controller';
import { AllowanceHeadService } from './allowance-head.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';

@Module({
  imports: [PrismaModule, ActivityLogsModule],
  controllers: [AllowanceHeadController],
  providers: [AllowanceHeadService],
})
export class AllowanceHeadModule {}
