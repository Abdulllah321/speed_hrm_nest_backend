import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../../../database/prisma.service';
import { UploadEventsService } from '../../../finance/item/upload-events.service';
import { BaseBulkUploadService } from '../../../common/services/base-bulk-upload.service';

@Injectable()
export class HsCodeBulkUploadService extends BaseBulkUploadService {
    constructor(
        @InjectQueue('hscode-upload') uploadQueue: Queue,
        prisma: PrismaService,
        eventsService: UploadEventsService,
    ) {
        super(uploadQueue, prisma, eventsService, 'hscode');
    }
}
