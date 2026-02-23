import { Module } from '@nestjs/common';
import { VendorQuotationService } from './vendor-quotation.service';
import { VendorQuotationController } from './vendor-quotation.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [VendorQuotationController],
  providers: [VendorQuotationService],
  exports: [VendorQuotationService],
})
export class VendorQuotationModule {}
