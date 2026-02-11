import { Module } from '@nestjs/common';
import { GrnService } from './grn.service';
import { GrnController } from './grn.controller';

@Module({
    controllers: [GrnController],
    providers: [GrnService],
    exports: [GrnService],
})
export class GrnModule { }
