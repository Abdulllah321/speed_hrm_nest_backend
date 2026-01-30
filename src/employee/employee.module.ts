import { Module } from '@nestjs/common';
import { EmployeeController } from './employee.controller';
import { EmployeeService } from './employee.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [PrismaModule, DatabaseModule],
  controllers: [EmployeeController],
  providers: [EmployeeService],
})
export class EmployeeModule {}
