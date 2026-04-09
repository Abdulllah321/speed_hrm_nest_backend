import { Module } from '@nestjs/common';
import { PosClaimsController } from './pos-claims.controller';
import { PosClaimsService } from './pos-claims.service';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [DatabaseModule],
    controllers: [PosClaimsController],
    providers: [PosClaimsService],
    exports: [PosClaimsService],
})
export class PosClaimsModule { }
