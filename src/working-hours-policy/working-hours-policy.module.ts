import { Module } from '@nestjs/common';
import { WorkingHoursPolicyController } from './working-hours-policy.controller';
import { WorkingHoursPolicyService } from './working-hours-policy.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [WorkingHoursPolicyController],
  providers: [WorkingHoursPolicyService],
})
export class WorkingHoursPolicyModule {}
