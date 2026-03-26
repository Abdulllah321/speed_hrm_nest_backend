import { Module } from '@nestjs/common';
import { QualificationController } from './qualification.controller';
import { QualificationService } from './qualification.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [PrismaModule, DatabaseModule],
  controllers: [QualificationController],
  providers: [QualificationService],
})
export class QualificationModule {}
