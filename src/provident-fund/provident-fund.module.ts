import { Module } from '@nestjs/common';
import { ProvidentFundController } from './provident-fund.controller';
import { ProvidentFundService } from './provident-fund.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ProvidentFundController],
  providers: [ProvidentFundService],
})
export class ProvidentFundModule {}
