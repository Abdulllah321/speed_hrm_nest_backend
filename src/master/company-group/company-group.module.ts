import { Module } from '@nestjs/common';
import { CompanyGroupService } from './company-group.service';
import { CompanyGroupController } from './company-group.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CompanyGroupController],
  providers: [CompanyGroupService],
})
export class CompanyGroupModule {}
