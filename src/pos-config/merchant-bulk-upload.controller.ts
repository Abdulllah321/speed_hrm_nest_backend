import {
    Controller,
    Post,
    Get,
    Delete,
    Param,
    UseGuards,
    Res,
    HttpStatus,
    BadRequestException,
    Req,
    Sse,
    MessageEvent,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { MerchantBulkUploadService } from './merchant-bulk-upload.service';
import { GetUser } from '../common/decorators/get-user.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UploadEventsService } from '../finance/item/upload-events.service';
import { Observable } from 'rxjs';

@ApiTags('Merchant Bulk Upload')
@Controller('api/pos-config/merchants/bulk-upload')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MerchantBulkUploadController {
    constructor(
        private bulkUploadService: MerchantBulkUploadService,
        private eventsService: UploadEventsService,
    ) { }

    /**
     * POST /api/pos-config/merchants/bulk-upload
     * Upload CSV/Excel and start validation
     */
    @Post()
    @ApiOperation({ summary: 'Upload Merchant config file for validation' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.merchant.create'))
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

        const result = await this.bulkUploadService.initiateValidation(buffer, file.filename, userId);

        return { status: true, message: 'Merchant validation initiated', data: result };
    }

    /**
     * POST /api/pos-config/merchants/bulk-upload/:uploadId/confirm
     */
    @Post(':uploadId/confirm')
    @ApiOperation({ summary: 'Confirm and start import of valid Merchant records' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.merchant.create'))
    async confirmUpload(@Param('uploadId') uploadId: string, @GetUser('id') userId: string) {
        const result = await this.bulkUploadService.confirmUpload(uploadId, userId);
        return { status: true, message: 'Merchant import confirmed and started', data: result };
    }

    /**
     * SSE /api/pos-config/merchants/bulk-upload/:uploadId/events
     */
    @Sse(':uploadId/events')
    @ApiOperation({ summary: 'Stream Merchant bulk upload events (SSE)' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.merchant.read'))
    streamEvents(@Param('uploadId') uploadId: string): Observable<MessageEvent> {
        return this.eventsService.subscribe(uploadId);
    }

    /**
     * GET /api/pos-config/merchants/bulk-upload/:uploadId/status
     */
    @Get(':uploadId/status')
    @ApiOperation({ summary: 'Get Merchant upload status' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.merchant.read'))
    async getUploadStatus(@Param('uploadId') uploadId: string) {
        const status = await this.bulkUploadService.getUploadStatus(uploadId);
        return { status: true, data: status };
    }

    /**
     * DELETE /api/pos-config/merchants/bulk-upload/:uploadId
     */
    @Delete(':uploadId')
    @ApiOperation({ summary: 'Cancel Merchant upload' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.merchant.delete'))
    async cancelUpload(@Param('uploadId') uploadId: string) {
        await this.bulkUploadService.cancelUpload(uploadId);
        return { status: true, message: 'Merchant upload cancelled successfully' };
    }

    /**
     * GET /api/pos-config/merchants/bulk-upload/history/list
     */
    @Get('history/list')
    @ApiOperation({ summary: 'Get Merchant upload history' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.merchant.read'))
    async getUploadHistory(@GetUser('id') userId: string) {
        const history = await this.bulkUploadService.getUploadHistory(userId);
        return { status: true, data: history };
    }

    /**
     * GET /api/pos-config/merchants/bulk-upload/:uploadId/error-report
     */
    @Get(':uploadId/error-report')
    @ApiOperation({ summary: 'Download Merchant error report' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.merchant.read'))
    async downloadErrorReport(@Param('uploadId') uploadId: string, @Res() res: any) {
        const upload = await this.bulkUploadService.getUploadStatus(uploadId);
        const csv = this.bulkUploadService.generateErrorReport(upload.errors as any[]);
        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', `attachment; filename="merchant-upload-errors-${uploadId}.csv"`);
        return res.status(HttpStatus.OK).send(csv);
    }

    /**
     * GET /api/pos-config/merchants/bulk-upload/template/download
     */
    @Get('template/download')
    @ApiOperation({ summary: 'Download Merchant CSV template' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.merchant.read'))
    async downloadTemplate(@Res() res: any) {
        const template = [
            'CostCentre,Tag ID,Description,Bank,Merchant code,Commission Rate Decimal,Commission Rate %,Bank GL Code',
            'C&K-CENTAURUS MALL,CK1006,C&K-CENTAURUS MALL | HBL,HBL,1,0.01100,1.100%,31100005',
            'C&K-CENTAURUS MALL,CK1006,C&K-CENTAURUS MALL | ALFALAH,AL-Falah,2,0.00700,0.700%,31100004',
        ].join('\n');
        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', 'attachment; filename="merchant-upload-template.csv"');
        return res.status(HttpStatus.OK).send(template);
    }
}
