import { Module } from '@nestjs/common';
import { EobiController } from './eobi.controller';
import { EobiService } from './eobi.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EobiController],
  providers: [EobiService],
})
export class EobiModule {}
