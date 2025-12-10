import { Global, Module } from '@nestjs/common';
import { ActivityLogsService } from './activity-logs.service';
import { ActivityLogsGateway } from './activity-logs.gateway';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [ActivityLogsGateway, ActivityLogsService],
  exports: [ActivityLogsGateway, ActivityLogsService],
})
export class ActivityLogsModule {}
