import { Module } from '@nestjs/common';
import { PFController } from './pf.controller';
import { PFService } from './pf.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [PrismaModule, DatabaseModule],
  controllers: [PFController],
  providers: [PFService],
  exports: [PFService],
})
export class PFModule {}
