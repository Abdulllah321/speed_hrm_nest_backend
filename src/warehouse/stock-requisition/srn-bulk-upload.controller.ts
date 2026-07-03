import { Controller, Post, Get, Delete, Param, UseGuards, Res, HttpStatus, BadRequestException, Req, Sse, MessageEvent } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SrnBulkUploadService } from './srn-bulk-upload.service';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { Observable } from 'rxjs';

@ApiTags('Stock Requisition Bulk Upload')
@Controller('api/stock-requisition/bulk-upload')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SrnBulkUploadController {
    constructor(
        private bulkUploadService: SrnBulkUploadService,
        private eventsService: UploadEventsService,
    ) { }

    @Post()
    @ApiOperation({ summary: 'Upload SRN CSV/Excel file for validation' })
    async uploadFile(@Req() req: any, @GetUser('id') userId: string) {
        const file = await req.file();
        if (!file) throw new BadRequestException('No file uploaded');

        const ext = file.filename.split('.').pop()?.toLowerCase();
        if (!ext || !['csv', 'xlsx', 'xls'].includes(ext)) throw new BadRequestException('Invalid file type. Allowed: csv, xlsx, xls');

        const buffer = await file.toBuffer();
        if (buffer.length > 50 * 1024 * 1024) throw new BadRequestException('File size exceeds 50MB limit');

        const { fromWarehouseId, toLocationId, brandId, documentType, financialYear, remarks, notes } = (req.query || {}) as any;
        const result = await this.bulkUploadService.initiateValidation(buffer, file.filename, userId, {
            fromWarehouseId, toLocationId, brandId, documentType, financialYear, remarks, notes,
        });
        return { status: true, message: 'SRN validation initiated', data: result };
    }

    @Post(':uploadId/confirm')
    @ApiOperation({ summary: 'Confirm and start SRN import' })
    async confirmUpload(@Param('uploadId') uploadId: string, @GetUser('id') userId: string, @Req() req: any) {
        const { fromWarehouseId, toLocationId, brandId, documentType, financialYear, remarks, notes } = (req.query || {}) as any;
        const result = await this.bulkUploadService.confirmUpload(uploadId, userId, {
            fromWarehouseId, toLocationId, brandId, documentType, financialYear, remarks, notes,
        });
        return { status: true, message: 'SRN import confirmed and started', data: result };
    }

    @Sse(':uploadId/events')
    @ApiOperation({ summary: 'Stream SRN bulk upload events (SSE)' })
    streamEvents(@Param('uploadId') uploadId: string): Observable<MessageEvent> {
        return this.eventsService.subscribe(uploadId);
    }

    @Get(':uploadId/status')
    @ApiOperation({ summary: 'Get SRN upload status' })
    async getUploadStatus(@Param('uploadId') uploadId: string) {
        return { status: true, data: await this.bulkUploadService.getUploadStatus(uploadId) };
    }

    @Delete(':uploadId')
    @ApiOperation({ summary: 'Cancel SRN upload' })
    async cancelUpload(@Param('uploadId') uploadId: string) {
        await this.bulkUploadService.cancelUpload(uploadId);
        return { status: true, message: 'SRN upload cancelled' };
    }

    @Get(':uploadId/error-report')
    @ApiOperation({ summary: 'Download SRN error report CSV' })
    async downloadErrorReport(@Param('uploadId') uploadId: string, @Res() res: any) {
        const upload = await this.bulkUploadService.getUploadStatus(uploadId);
        const csv = this.bulkUploadService.generateErrorReport(upload.errors as any[]);
        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', `attachment; filename="srn-upload-errors-${uploadId}.csv"`);
        return res.status(HttpStatus.OK).send(csv);
    }

    @Get('template/download')
    @ApiOperation({ summary: 'Download SRN CSV template' })
    async downloadTemplate(@Res() res: any) {
        const template = [
            'BarCode,SKU,Quantity',
            '889362319896,,10',
            ',ABC-001-BLK-M,25',
        ].join('\n');
        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', 'attachment; filename="srn-upload-template.csv"');
        return res.status(HttpStatus.OK).send(template);
    }
}
