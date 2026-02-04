import { Module } from '@nestjs/common';
import { SaleTypeService } from './sale-type.service';
import { SaleTypeController } from './sale-type.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SaleTypeController],
  providers: [SaleTypeService],
})
export class SaleTypeModule {}
