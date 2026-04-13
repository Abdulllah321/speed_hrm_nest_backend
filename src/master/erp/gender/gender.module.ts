import { Module } from '@nestjs/common';
import { GenderController } from './gender.controller';
import { GenderService } from './gender.service';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [GenderController],
  providers: [GenderService],
})
export class GenderModule {}
