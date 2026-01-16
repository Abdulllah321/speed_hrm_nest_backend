import { Module } from '@nestjs/common';
import { EmployeeGradeController } from './employee-grade.controller';
import { EmployeeGradeService } from './employee-grade.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EmployeeGradeController],
  providers: [EmployeeGradeService],
})
export class EmployeeGradeModule {}
