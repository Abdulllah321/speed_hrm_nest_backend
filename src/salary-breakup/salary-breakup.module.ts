import { Module } from '@nestjs/common'
import { SalaryBreakupController } from './salary-breakup.controller'
import { SalaryBreakupService } from './salary-breakup.service'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [SalaryBreakupController],
  providers: [SalaryBreakupService],
})
export class SalaryBreakupModule {}
