import { Global, Module } from '@nestjs/common';
import { ActivityLogsService } from './activity-logs.service';
import { ActivityLogsGateway } from './activity-logs.gateway';
import { ActivityLogsController } from './activity-logs.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [ActivityLogsController],
  providers: [ActivityLogsGateway, ActivityLogsService],
  exports: [ActivityLogsGateway, ActivityLogsService],
})
export class ActivityLogsModule {}
