import { Module } from '@nestjs/common';
import { PosConfigController } from './pos-config.controller';
import { PosConfigService } from './pos-config.service';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [DatabaseModule],
    controllers: [PosConfigController],
    providers: [PosConfigService],
    exports: [PosConfigService],
})
export class PosConfigModule { }
