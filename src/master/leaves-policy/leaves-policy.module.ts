import { Module } from '@nestjs/common';
import { LeavesPolicyController } from './leaves-policy.controller';
import { LeavesPolicyService } from './leaves-policy.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [LeavesPolicyController],
  providers: [LeavesPolicyService],
})
export class LeavesPolicyModule {}
