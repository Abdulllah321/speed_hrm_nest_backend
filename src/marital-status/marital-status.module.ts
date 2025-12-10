import { Module } from '@nestjs/common'
import { MaritalStatusController } from './marital-status.controller'
import { MaritalStatusService } from './marital-status.service'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [MaritalStatusController],
  providers: [MaritalStatusService],
})
export class MaritalStatusModule {}
