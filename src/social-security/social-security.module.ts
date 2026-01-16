import { Module } from '@nestjs/common';
import { SocialSecurityController } from './social-security.controller';
import { SocialSecurityService } from './social-security.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';

@Module({
  imports: [PrismaModule, ActivityLogsModule],
  controllers: [SocialSecurityController],
  providers: [SocialSecurityService],
})
export class SocialSecurityModule {}
