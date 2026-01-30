import { Module } from '@nestjs/common';
import { WorkingHoursPolicyController } from './working-hours-policy.controller';
import { WorkingHoursPolicyService } from './working-hours-policy.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [WorkingHoursPolicyController],
  providers: [WorkingHoursPolicyService],
})
export class WorkingHoursPolicyModule {}
