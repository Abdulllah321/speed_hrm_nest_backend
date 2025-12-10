import { Module } from '@nestjs/common'
import { BranchController } from './branch.controller'
import { BranchService } from './branch.service'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [BranchController],
  providers: [BranchService],
})
export class BranchModule {}
