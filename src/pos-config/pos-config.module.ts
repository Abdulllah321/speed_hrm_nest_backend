import { Module } from '@nestjs/common';
import { PosConfigController } from './pos-config.controller';
import { PosConfigService } from './pos-config.service';
import { VoucherService } from './voucher.service';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [DatabaseModule],
    controllers: [PosConfigController],
    providers: [PosConfigService, VoucherService],
    exports: [PosConfigService, VoucherService],
})
export class PosConfigModule { }
