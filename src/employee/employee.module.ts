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
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    PrismaModule,
    DatabaseModule,
    NotificationsModule,
    BullModule.registerQueue({
      name: 'employee-upload',
    }),
  ],
  controllers: [EmployeeController],
  providers: [
    EmployeeService,
    CsvParserService,
    EmployeeBulkUploadService,
    EmployeeValidatorService,
    EmployeeUploadEventsService,
    EmployeeUploadProcessor,
  ],
  exports: [EmployeeService, EmployeeBulkUploadService],
})
export class EmployeeModule { }
