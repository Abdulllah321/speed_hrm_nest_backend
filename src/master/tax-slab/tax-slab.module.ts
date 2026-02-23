import { Module } from '@nestjs/common';
import { TaxSlabController } from './tax-slab.controller';
import { TaxSlabService } from './tax-slab.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TaxSlabController],
  providers: [TaxSlabService],
})
export class TaxSlabModule {}
