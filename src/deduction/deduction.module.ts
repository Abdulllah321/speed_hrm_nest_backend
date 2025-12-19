import { Module } from '@nestjs/common';
import { DeductionController } from './deduction.controller';
import { DeductionService } from './deduction.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';

@Module({
  imports: [PrismaModule, ActivityLogsModule],
  controllers: [DeductionController],
  providers: [DeductionService],
  exports: [DeductionService],
})
export class DeductionModule {}
