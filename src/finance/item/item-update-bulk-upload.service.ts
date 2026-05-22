import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { UploadEventsService } from './upload-events.service';
import { BaseBulkUploadService } from '../../common/services/base-bulk-upload.service';

@Injectable()
export class ItemUpdateBulkUploadService extends BaseBulkUploadService {
    constructor(
        @InjectQueue('item-update-upload') uploadQueue: Queue,
        prisma: PrismaService,
        eventsService: UploadEventsService,
    ) {
        // Pass queue, prisma, eventsService, and uploadType identifier to base class
        super(uploadQueue, prisma, eventsService, 'item-update');
    }
}
