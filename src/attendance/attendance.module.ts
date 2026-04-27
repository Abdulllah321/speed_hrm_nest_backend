import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { BullModule } from '@nestjs/bull';
import { CsvParserService } from '../common/services/csv-parser.service';
import { AttendanceBulkUploadService } from './attendance-bulk-upload.service';
import { AttendanceValidatorService } from '../common/services/attendance-validator.service';
import { AttendanceUploadEventsService } from './attendance-upload-events.service';
import { AttendanceUploadProcessor } from '../queue/processors/attendance-upload.processor';

@Module({
  imports: [
    PrismaModule, 
    ActivityLogsModule,
    BullModule.registerQueue({
      name: 'attendance-upload',
    }),
  ],
  controllers: [AttendanceController],
  providers: [
    AttendanceService,
    CsvParserService,
    AttendanceBulkUploadService,
    AttendanceValidatorService,
    AttendanceUploadEventsService,
    AttendanceUploadProcessor,
  ],
  exports: [AttendanceService, AttendanceBulkUploadService],
})
export class AttendanceModule {}
