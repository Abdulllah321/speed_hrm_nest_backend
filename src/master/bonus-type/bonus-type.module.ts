import { Module } from '@nestjs/common';
import { BonusTypeController } from './bonus-type.controller';
import { BonusTypeService } from './bonus-type.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BonusTypeController],
  providers: [BonusTypeService],
})
export class BonusTypeModule {}
