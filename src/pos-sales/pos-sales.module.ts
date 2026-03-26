import { Module } from '@nestjs/common';
import { PosSalesController } from './pos-sales.controller';
import { PosSalesService } from './pos-sales.service';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [DatabaseModule],
    controllers: [PosSalesController],
    providers: [PosSalesService],
    exports: [PosSalesService],
})
export class PosSalesModule { }
