import { Module } from '@nestjs/common';
import { EmployeeController } from './employee.controller';
import { EmployeeService } from './employee.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DatabaseModule } from '../database/database.module';
import { BullModule } from '@nestjs/bull';
import { CsvParserService } from '../common/services/csv-parser.service';
import { EmployeeBulkUploadService } from './employee-bulk-upload.service';
import { EmployeeValidatorService } from '../common/services/employee-validator.service';
import { EmployeeUploadEventsService } from './employee-upload-events.service';
import { EmployeeUploadProcessor } from '../queue/processors/employee-upload.processor';
import { EmployeeExportController } from './employee-export.controller';
import { EmployeeExportService } from './employee-export.service';
import { EmployeeExportProcessor } from './employee-export.processor';
import { NotificationsModule } from '../notifications/notifications.module';
import { ExportHistoryModule } from '../warehouse/export-history/export-history.module';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [
    PrismaModule,
    DatabaseModule,
    NotificationsModule,
    ExportHistoryModule,
    UploadModule,
    BullModule.registerQueue(
      { name: 'employee-upload' },
      { name: 'employee-export' },
    ),
  ],
  controllers: [EmployeeController, EmployeeExportController],
  providers: [
    EmployeeService,
    CsvParserService,
    EmployeeBulkUploadService,
    EmployeeValidatorService,
    EmployeeUploadEventsService,
    EmployeeUploadProcessor,
    EmployeeExportService,
    EmployeeExportProcessor,
  ],
  exports: [EmployeeService, EmployeeBulkUploadService],
})
export class EmployeeModule { }
