import { Module, forwardRef } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DatabaseModule } from '../database/database.module';
import { CompanyModule } from '../admin/company/company.module';
import { PosModule } from '../master/pos/pos.module';
import { PosSessionModule } from '../pos-session/pos-session.module';

@Module({
  imports: [DatabaseModule, forwardRef(() => CompanyModule), PosModule, PosSessionModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule { }
