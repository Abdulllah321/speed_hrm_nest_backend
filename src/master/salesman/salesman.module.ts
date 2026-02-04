import { Module } from '@nestjs/common';
import { SalesmanService } from './salesman.service';
import { SalesmanController } from './salesman.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SalesmanController],
  providers: [SalesmanService],
})
export class SalesmanModule {}
