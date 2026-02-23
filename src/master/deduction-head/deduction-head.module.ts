import { Module } from '@nestjs/common';
import { DeductionHeadController } from './deduction-head.controller';
import { DeductionHeadService } from './deduction-head.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ActivityLogsModule } from '../../activity-logs/activity-logs.module';

@Module({
  imports: [PrismaModule, ActivityLogsModule],
  controllers: [DeductionHeadController],
  providers: [DeductionHeadService],
})
export class DeductionHeadModule {}
