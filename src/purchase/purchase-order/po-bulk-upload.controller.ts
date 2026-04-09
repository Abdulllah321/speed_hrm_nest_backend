import { Controller, Post, Get, Delete, Param, UseGuards, Res, HttpStatus, BadRequestException, Req, Sse, MessageEvent } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PoBulkUploadService } from './po-bulk-upload.service';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { Observable } from 'rxjs';

@ApiTags('Purchase Order Bulk Upload')
@Controller('api/purchase-order/bulk-upload')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PoBulkUploadController {
    constructor(
        private bulkUploadService: PoBulkUploadService,
        private eventsService: UploadEventsService,
    ) { }

    @Post()
    @ApiOperation({ summary: 'Upload PO CSV/Excel file for validation' })
    async uploadFile(@Req() req: any, @GetUser('id') userId: string) {
        const file = await req.file();
        if (!file) throw new BadRequestException('No file uploaded');

        const ext = file.filename.split('.').pop()?.toLowerCase();
        if (!ext || !['csv', 'xlsx', 'xls'].includes(ext)) throw new BadRequestException('Invalid file type. Allowed: csv, xlsx, xls');

        const buffer = await file.toBuffer();
        if (buffer.length > 50 * 1024 * 1024) throw new BadRequestException('File size exceeds 50MB limit');

        const result = await this.bulkUploadService.initiateValidation(buffer, file.filename, userId);
        return { status: true, message: 'PO validation initiated', data: result };
    }

    @Post(':uploadId/confirm')
    @ApiOperation({ summary: 'Confirm and start PO import' })
    async confirmUpload(@Param('uploadId') uploadId: string, @GetUser('id') userId: string) {
        const result = await this.bulkUploadService.confirmUpload(uploadId, userId);
        return { status: true, message: 'PO import confirmed and started', data: result };
    }

    @Sse(':uploadId/events')
    @ApiOperation({ summary: 'Stream PO bulk upload events (SSE)' })
    streamEvents(@Param('uploadId') uploadId: string): Observable<MessageEvent> {
        return this.eventsService.subscribe(uploadId);
    }

    @Get(':uploadId/status')
    @ApiOperation({ summary: 'Get PO upload status' })
    async getUploadStatus(@Param('uploadId') uploadId: string) {
        return { status: true, data: await this.bulkUploadService.getUploadStatus(uploadId) };
    }

    @Delete(':uploadId')
    @ApiOperation({ summary: 'Cancel PO upload' })
    async cancelUpload(@Param('uploadId') uploadId: string) {
        await this.bulkUploadService.cancelUpload(uploadId);
        return { status: true, message: 'PO upload cancelled' };
    }

    @Get(':uploadId/error-report')
    @ApiOperation({ summary: 'Download PO error report CSV' })
    async downloadErrorReport(@Param('uploadId') uploadId: string, @Res() res: any) {
        const upload = await this.bulkUploadService.getUploadStatus(uploadId);
        const csv = this.bulkUploadService.generateErrorReport(upload.errors as any[]);
        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', `attachment; filename="po-upload-errors-${uploadId}.csv"`);
        return res.status(HttpStatus.OK).send(csv);
    }

    @Get('template/download')
    @ApiOperation({ summary: 'Download PO CSV template' })
    async downloadTemplate(@Res() res: any) {
        const template = [
            'Vendor Code,Item ID,Description,Quantity,Unit Price,Order Type,Goods Type,Expected Delivery Date,Notes',
            '// Rules: One vendor per file | Order Type must be same for all rows | Goods Type must be same for all rows',
            '// LOCAL vendor → ORDER TYPE must be LOCAL | IMPORT vendor → ORDER TYPE must be IMPORT',
            'IMP001,00001,Nike Air Max 90,10,5000,IMPORT,FRESH,2026-05-01,Spring collection',
            'IMP001,00002,Nike Air Force 1,5,4500,IMPORT,FRESH,2026-05-01,',
        ].join('\n');
        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', 'attachment; filename="po-upload-template.csv"');
        return res.status(HttpStatus.OK).send(template);
    }
}
