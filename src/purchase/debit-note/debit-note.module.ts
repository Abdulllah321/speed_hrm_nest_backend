import { Module } from '@nestjs/common';
import { DebitNoteService } from './debit-note.service';
import { DebitNoteController } from './debit-note.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DebitNoteController],
  providers: [DebitNoteService],
  exports: [DebitNoteService],
})
export class DebitNoteModule {}
