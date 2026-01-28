import { Module } from '@nestjs/common';
import { LoanTypeController } from './loan-type.controller';
import { LoanTypeService } from './loan-type.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [LoanTypeController],
  providers: [LoanTypeService],
})
export class LoanTypeModule {}
