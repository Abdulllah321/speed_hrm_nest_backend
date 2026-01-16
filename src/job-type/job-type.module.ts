import { Module } from '@nestjs/common';
import { JobTypeController } from './job-type.controller';
import { JobTypeService } from './job-type.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [JobTypeController],
  providers: [JobTypeService],
})
export class JobTypeModule {}
