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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { StockBulkUploadService } from './stock-bulk-upload.service';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UploadEventsService } from '../../finance/item/upload-events.service';
import { Observable } from 'rxjs';

@ApiTags('Stock Bulk Upload')
@Controller('api/warehouse/stock/bulk-upload')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class StockBulkUploadController {
    constructor(
        private bulkUploadService: StockBulkUploadService,
        private eventsService: UploadEventsService,
    ) { }

    /**
     * POST /api/warehouse/stock/bulk-upload
     * Upload CSV/Excel and start validation
     */
    @Post()
    @ApiOperation({ summary: 'Upload stock file for validation' })
    @UseGuards(JwtAuthGuard, PermissionGuard('warehouse.stock.create'))
    async uploadFile(@Req() req: any, @GetUser('id') userId: string) {
        const file = await req.file();
        if (!file) throw new BadRequestException('No file uploaded');

        const allowedExtensions = ['csv', 'xlsx', 'xls'];
        const ext = file.filename.split('.').pop()?.toLowerCase();
        if (!ext || !allowedExtensions.includes(ext)) {
            throw new BadRequestException(`Invalid file type. Allowed: ${allowedExtensions.join(', ')}`);
        }

        const buffer = await file.toBuffer();
        const maxSize = 50 * 1024 * 1024; // 50MB
        if (buffer.length > maxSize) throw new BadRequestException('File size exceeds 50MB limit');

        const result = await this.bulkUploadService.initiateValidation(buffer, file.filename, userId);

        return { status: true, message: 'Stock validation initiated', data: result };
    }

    /**
     * POST /api/warehouse/stock/bulk-upload/:uploadId/confirm
     */
    @Post(':uploadId/confirm')
    @ApiOperation({ summary: 'Confirm and start import of valid stock records' })
    @UseGuards(JwtAuthGuard, PermissionGuard('warehouse.stock.create'))
    async confirmUpload(@Param('uploadId') uploadId: string, @GetUser('id') userId: string) {
        const result = await this.bulkUploadService.confirmUpload(uploadId, userId);
        return { status: true, message: 'Stock import confirmed and started', data: result };
    }

    /**
     * SSE /api/warehouse/stock/bulk-upload/:uploadId/events
     */
    @Sse(':uploadId/events')
    @ApiOperation({ summary: 'Stream stock bulk upload events (SSE)' })
    @UseGuards(JwtAuthGuard, PermissionGuard('warehouse.stock.read'))
    streamEvents(@Param('uploadId') uploadId: string): Observable<MessageEvent> {
        return this.eventsService.subscribe(uploadId);
    }

    /**
     * GET /api/warehouse/stock/bulk-upload/:uploadId/status
     */
    @Get(':uploadId/status')
    @ApiOperation({ summary: 'Get stock upload status' })
    @UseGuards(JwtAuthGuard, PermissionGuard('warehouse.stock.read'))
    async getUploadStatus(@Param('uploadId') uploadId: string) {
        const status = await this.bulkUploadService.getUploadStatus(uploadId);
        return { status: true, data: status };
    }

    /**
     * DELETE /api/warehouse/stock/bulk-upload/:uploadId
     */
    @Delete(':uploadId')
    @ApiOperation({ summary: 'Cancel stock upload' })
    @UseGuards(JwtAuthGuard, PermissionGuard('warehouse.stock.delete'))
    async cancelUpload(@Param('uploadId') uploadId: string) {
        await this.bulkUploadService.cancelUpload(uploadId);
        return { status: true, message: 'Stock upload cancelled successfully' };
    }

    /**
     * GET /api/warehouse/stock/bulk-upload/history/list
     */
    @Get('history/list')
    @ApiOperation({ summary: 'Get stock upload history' })
    @UseGuards(JwtAuthGuard, PermissionGuard('warehouse.stock.read'))
    async getUploadHistory(@GetUser('id') userId: string) {
        const history = await this.bulkUploadService.getUploadHistory(userId);
        return { status: true, data: history };
    }

    /**
     * GET /api/warehouse/stock/bulk-upload/:uploadId/error-report
     */
    @Get(':uploadId/error-report')
    @ApiOperation({ summary: 'Download stock upload error report' })
    @UseGuards(JwtAuthGuard, PermissionGuard('warehouse.stock.read'))
    async downloadErrorReport(@Param('uploadId') uploadId: string, @Res() res: any) {
        const upload = await this.bulkUploadService.getUploadStatus(uploadId);
        const csv = this.bulkUploadService.generateErrorReport(upload.errors as any[]);
        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', `attachment; filename="stock-upload-errors-${uploadId}.csv"`);
        return res.status(HttpStatus.OK).send(csv);
    }

    /**
     * GET /api/warehouse/stock/bulk-upload/template/download
     *
     * Returns a wide-format template: BarCode column + one column per location code.
     * The actual location codes are fetched live from the DB so the template is always
     * up-to-date with the tenant's locations.
     */
    @Get('template/download')
    @ApiOperation({ summary: 'Download stock upload CSV template' })
    @UseGuards(JwtAuthGuard, PermissionGuard('warehouse.stock.read'))
    async downloadTemplate(@Res() res: any) {
        // Static example template — matches the wide-format the parser expects.
        // In production you could fetch real location codes from the DB here.
        const template = [
            'BarCode,C40001,N10001,SS1001,SS1002,SS1011,CK1001,CK1002,P10001,P10002,P10004,A10002,W10012',
            '4055013454094,-,-,-,1,-,-,-,-,-,-,-,10',
            '4059809047132,2,-,-,-,-,-,-,-,-,-,1,10',
            '4059809047095,1,-,-,-,-,-,-,-,-,-,2,10',
            '4059809047101,-,5,-,-,3,-,-,2,-,-,-,-',
            '4059809047118,-,-,4,-,-,1,-,-,6,-,-,-',
        ].join('\n');

        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', 'attachment; filename="stock-upload-template.csv"');
        return res.status(HttpStatus.OK).send(template);
    }
}
