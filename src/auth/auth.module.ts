import { Module, forwardRef } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DatabaseModule } from '../database/database.module';
import { CompanyModule } from '../admin/company/company.module';
import { PosModule } from '../master/pos/pos.module';

@Module({
  imports: [DatabaseModule, forwardRef(() => CompanyModule), PosModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
