import { Module, forwardRef } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { DatabaseModule } from '../database/database.module';
import { EOBIModule } from '../eobi/eobi.module';

@Module({
  imports: [
    PrismaModule,
    ActivityLogsModule,
    DatabaseModule,
    forwardRef(() => EOBIModule),
  ],
  controllers: [PayrollController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
