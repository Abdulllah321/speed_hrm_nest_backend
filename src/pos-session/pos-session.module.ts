import { Module } from '@nestjs/common';
import { PosSessionService } from './pos-session.service';
import { PosSessionController } from './pos-session.controller';

@Module({
  providers: [PosSessionService],
  controllers: [PosSessionController],
  exports: [PosSessionService],
})
export class PosSessionModule { }
