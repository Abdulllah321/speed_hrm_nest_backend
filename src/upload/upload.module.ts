import { Module } from '@nestjs/common';
import { UploadService } from './upload.service';
import { UploadController } from './upload.controller';
import { BulkUploadSseController } from './bulk-upload-sse.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [UploadService],
  controllers: [UploadController, BulkUploadSseController],
  exports: [UploadService],
})
export class UploadModule {}
