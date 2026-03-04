import { Module } from '@nestjs/common';
import { HsCodeService } from './hs-code.service';
import { HsCodeController } from './hs-code.controller';

@Module({
    controllers: [HsCodeController],
    providers: [HsCodeService],
    exports: [HsCodeService],
})
export class HsCodeModule { }
