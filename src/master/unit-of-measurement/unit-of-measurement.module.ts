import { Module } from '@nestjs/common';
import { UnitOfMeasurementController } from './unit-of-measurement.controller';
import { UnitOfMeasurementService } from './unit-of-measurement.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [UnitOfMeasurementController],
  providers: [UnitOfMeasurementService],
})
export class UnitOfMeasurementModule {}
