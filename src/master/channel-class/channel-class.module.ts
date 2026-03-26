import { Module } from '@nestjs/common';
import { ChannelClassController } from './channel-class.controller';
import { ChannelClassService } from './channel-class.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ChannelClassController],
  providers: [ChannelClassService],
})
export class ChannelClassModule {}
