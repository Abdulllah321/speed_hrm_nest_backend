import { Module } from '@nestjs/common';
import { IncrementController } from './increment.controller';
import { IncrementService } from './increment.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';

@Module({
  imports: [PrismaModule, ActivityLogsModule],
  controllers: [IncrementController],
  providers: [IncrementService],
  exports: [IncrementService],
})
export class IncrementModule {}
