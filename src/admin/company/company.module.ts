import { Module } from '@nestjs/common';
import { CompanyService } from './company.service';
import { CompanyController } from './company.controller';

import { forwardRef } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [CompanyController],
  providers: [CompanyService],
  exports: [CompanyService],
})
export class CompanyModule {}
