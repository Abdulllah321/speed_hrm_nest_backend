import {
    Post,
    Get,
    Delete,
    Param,
    Res,
    HttpStatus,
    BadRequestException,
    Req,
    Sse,
    MessageEvent,
} from '@nestjs/common';
import { GetUser } from '../decorators/get-user.decorator';
import { ApiOperation } from '@nestjs/swagger';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { BaseBulkUploadService } from '../services/base-bulk-upload.service';
import { Observable } from 'rxjs';

export abstract class BaseBulkUploadController {
    constructor(
        protected readonly service: BaseBulkUploadService,
        protected readonly eventsService: UploadEventsService,
        protected readonly entityLabel: string,
    ) { }

    @Post()
    @ApiOperation({ summary: 'Upload file for validation' })
    async uploadFile(@Req() req: any, @GetUser('id') userId: string) {
        const file = await req.file();
        if (!file) throw new BadRequestException('No file uploaded');

        const allowedExtensions = ['csv', 'xlsx', 'xls'];
        const ext = file.filename.split('.').pop()?.toLowerCase();
        if (!ext || !allowedExtensions.includes(ext)) {
            throw new BadRequestException(`Invalid file type. Allowed: ${allowedExtensions.join(', ')}`);
        }

        const buffer = await file.toBuffer();
        const maxSize = 50 * 1024 * 1024;
        if (buffer.length > maxSize) throw new BadRequestException('File size exceeds 50MB limit');

        const result = await this.service.initiateValidation(buffer, file.filename, userId);

        return { status: true, message: `${this.entityLabel} validation initiated`, data: result };
    }

    @Post(':uploadId/confirm')
    @ApiOperation({ summary: 'Confirm and start import of valid records' })
    async confirmUpload(@Param('uploadId') uploadId: string, @GetUser('id') userId: string) {
        const result = await this.service.confirmUpload(uploadId, userId);
        return { status: true, message: `${this.entityLabel} import confirmed and started`, data: result };
    }

    @Sse(':uploadId/events')
    @ApiOperation({ summary: 'Stream bulk upload events (SSE)' })
    streamEvents(@Param('uploadId') uploadId: string): Observable<MessageEvent> {
        return this.eventsService.subscribe(uploadId);
    }

    @Get(':uploadId/status')
    @ApiOperation({ summary: 'Get upload status' })
    async getUploadStatus(@Param('uploadId') uploadId: string) {
        const status = await this.service.getUploadStatus(uploadId);
        return { status: true, data: status };
    }

    @Delete(':uploadId')
    @ApiOperation({ summary: 'Cancel upload' })
    async cancelUpload(@Param('uploadId') uploadId: string) {
        await this.service.cancelUpload(uploadId);
        return { status: true, message: `${this.entityLabel} upload cancelled successfully` };
    }

    @Get('history/list')
    @ApiOperation({ summary: 'Get upload history' })
    async getUploadHistory(@GetUser('id') userId: string) {
        const history = await this.service.getUploadHistory(userId);
        return { status: true, data: history };
    }

    @Get(':uploadId/error-report')
    @ApiOperation({ summary: 'Download error report' })
    async downloadErrorReport(@Param('uploadId') uploadId: string, @Res() res: any) {
        const upload = await this.service.getUploadStatus(uploadId);
        const csv = this.service.generateErrorReport(upload.errors as any[]);
        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', `attachment; filename="${this.entityLabel.toLowerCase()}-upload-errors-${uploadId}.csv"`);
        return res.status(HttpStatus.OK).send(csv);
    }
}
