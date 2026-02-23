import { Module } from '@nestjs/common';
import { StorageDimensionService } from './storage-dimension.service';
import { StorageDimensionController } from './storage-dimension.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [StorageDimensionController],
  providers: [StorageDimensionService],
})
export class StorageDimensionModule {}
