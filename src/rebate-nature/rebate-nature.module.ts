import { Module } from '@nestjs/common';
import { RebateNatureService } from './rebate-nature.service';
import { RebateNatureController } from './rebate-nature.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RebateNatureController],
  providers: [RebateNatureService],
  exports: [RebateNatureService],
})
export class RebateNatureModule {}
