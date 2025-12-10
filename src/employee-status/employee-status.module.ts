import { Module } from '@nestjs/common'
import { EmployeeStatusController } from './employee-status.controller'
import { EmployeeStatusService } from './employee-status.service'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [EmployeeStatusController],
  providers: [EmployeeStatusService],
})
export class EmployeeStatusModule {}
