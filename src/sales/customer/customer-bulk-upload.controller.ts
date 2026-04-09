import { Controller, Post, Get, Delete, Param, UseGuards, Res, HttpStatus, BadRequestException, Req, Sse, MessageEvent } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerBulkUploadService } from './customer-bulk-upload.service';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { Observable } from 'rxjs';

@ApiTags('Customer Bulk Upload')
@Controller('api/sales/customers/bulk-upload')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CustomerBulkUploadController {
    constructor(
        private bulkUploadService: CustomerBulkUploadService,
        private eventsService: UploadEventsService,
    ) { }

    @Post()
    @ApiOperation({ summary: 'Upload customer CSV/Excel file for validation' })
    async uploadFile(@Req() req: any, @GetUser('id') userId: string) {
        const file = await req.file();
        if (!file) throw new BadRequestException('No file uploaded');

        const ext = file.filename.split('.').pop()?.toLowerCase();
        if (!ext || !['csv', 'xlsx', 'xls'].includes(ext)) {
            throw new BadRequestException('Invalid file type. Allowed: csv, xlsx, xls');
        }

        const buffer = await file.toBuffer();
        if (buffer.length > 50 * 1024 * 1024) throw new BadRequestException('File size exceeds 50MB limit');

        const result = await this.bulkUploadService.initiateValidation(buffer, file.filename, userId);
        return { status: true, message: 'Customer validation initiated', data: result };
    }

    @Post(':uploadId/confirm')
    @ApiOperation({ summary: 'Confirm and start import of valid customer records' })
    async confirmUpload(@Param('uploadId') uploadId: string, @GetUser('id') userId: string) {
        const result = await this.bulkUploadService.confirmUpload(uploadId, userId);
        return { status: true, message: 'Customer import confirmed and started', data: result };
    }

    @Sse(':uploadId/events')
    @ApiOperation({ summary: 'Stream customer bulk upload events (SSE)' })
    streamEvents(@Param('uploadId') uploadId: string): Observable<MessageEvent> {
        return this.eventsService.subscribe(uploadId);
    }

    @Get(':uploadId/status')
    @ApiOperation({ summary: 'Get customer upload status' })
    async getUploadStatus(@Param('uploadId') uploadId: string) {
        const status = await this.bulkUploadService.getUploadStatus(uploadId);
        return { status: true, data: status };
    }

    @Delete(':uploadId')
    @ApiOperation({ summary: 'Cancel customer upload' })
    async cancelUpload(@Param('uploadId') uploadId: string) {
        await this.bulkUploadService.cancelUpload(uploadId);
        return { status: true, message: 'Customer upload cancelled' };
    }

    @Get('history/list')
    @ApiOperation({ summary: 'Get customer upload history' })
    async getUploadHistory(@GetUser('id') userId: string) {
        const history = await this.bulkUploadService.getUploadHistory(userId);
        return { status: true, data: history };
    }

    @Get(':uploadId/error-report')
    @ApiOperation({ summary: 'Download customer error report CSV' })
    async downloadErrorReport(@Param('uploadId') uploadId: string, @Res() res: any) {
        const upload = await this.bulkUploadService.getUploadStatus(uploadId);
        const csv = this.bulkUploadService.generateErrorReport(upload.errors as any[]);
        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', `attachment; filename="customer-upload-errors-${uploadId}.csv"`);
        return res.status(HttpStatus.OK).send(csv);
    }

    @Get('template/download')
    @ApiOperation({ summary: 'Download customer CSV template' })
    async downloadTemplate(@Res() res: any) {
        const template = [
            'Code,Name of Customer,Address,Contact No.,Email',
            '310001,ZAHEER ASSOCIATES,"OFFICE NO 4, 109-WEST, SARDAR BEGUM PLAZA, BLUE AREA, Islamabad",03008552662,',
            '310002,SAMPLE CUSTOMER,"123 Main Street, Karachi",0300-1234567,sample@example.com',
        ].join('\n');
        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', 'attachment; filename="customer-upload-template.csv"');
        return res.status(HttpStatus.OK).send(template);
    }
}
