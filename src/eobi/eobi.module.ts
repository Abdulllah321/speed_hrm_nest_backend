import { Module } from '@nestjs/common';
import { EOBIController } from './eobi.controller';
import { EOBIService } from './eobi.service';
import { PrismaService } from '../database/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';

@Module({
  imports: [ActivityLogsModule],
  controllers: [EOBIController],
  providers: [EOBIService, PrismaService, PrismaMasterService],
  exports: [EOBIService],
})
export class EOBIModule {}
