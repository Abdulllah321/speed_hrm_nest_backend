import { Module } from '@nestjs/common';
import { SilhouetteController } from './silhouette.controller';
import { SilhouetteService } from './silhouette.service';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SilhouetteController],
  providers: [SilhouetteService],
})
export class SilhouetteModule {}
