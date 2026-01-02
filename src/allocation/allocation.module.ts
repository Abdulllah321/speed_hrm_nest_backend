import { Module } from '@nestjs/common';
import { AllocationService } from './allocation.service';
import { AllocationController } from './allocation.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';

@Module({
    imports: [PrismaModule, ActivityLogsModule],
    controllers: [AllocationController],
    providers: [AllocationService],
    exports: [AllocationService],
})
export class AllocationModule { }
