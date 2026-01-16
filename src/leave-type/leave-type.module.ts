import { Module } from '@nestjs/common';
import { LeaveTypeController } from './leave-type.controller';
import { LeaveTypeService } from './leave-type.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [LeaveTypeController],
  providers: [LeaveTypeService],
})
export class LeaveTypeModule {}
