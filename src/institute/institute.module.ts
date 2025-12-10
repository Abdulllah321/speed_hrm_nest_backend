import { Module } from '@nestjs/common'
import { InstituteController } from './institute.controller'
import { InstituteService } from './institute.service'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [InstituteController],
  providers: [InstituteService],
})
export class InstituteModule {}
