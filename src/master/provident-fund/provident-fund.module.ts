import { Module } from '@nestjs/common';
import { ProvidentFundController } from './provident-fund.controller';
import { ProvidentFundService } from './provident-fund.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [PrismaModule, DatabaseModule],
  controllers: [ProvidentFundController],
  providers: [ProvidentFundService],
})
export class ProvidentFundModule {}
