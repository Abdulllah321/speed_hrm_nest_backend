import { Module } from '@nestjs/common'
import { CityController } from './city.controller'
import { CityService } from './city.service'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [CityController],
  providers: [CityService],
})
export class CityModule {}
