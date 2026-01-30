import { Module } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [PrismaModule, ActivityLogsModule, DatabaseModule],
  controllers: [PayrollController],
  providers: [PayrollService],
})
export class PayrollModule {}
