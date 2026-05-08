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
import { AllianceBulkUploadService } from './alliance-bulk-upload.service';
import { GetUser } from '../common/decorators/get-user.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UploadEventsService } from '../finance/item/upload-events.service';
import { Observable } from 'rxjs';

@ApiTags('Alliance Bulk Upload')
@Controller('api/pos-config/alliances/bulk-upload')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AllianceBulkUploadController {
    constructor(
        private bulkUploadService: AllianceBulkUploadService,
        private eventsService: UploadEventsService,
    ) { }

    /**
     * POST /api/pos-config/alliances/bulk-upload
     * Upload CSV/Excel and start validation
     */
    @Post()
    @ApiOperation({ summary: 'Upload Alliance Discount file for validation' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.alliance.create'))
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

        return { status: true, message: 'Alliance validation initiated', data: result };
    }

    /**
     * POST /api/pos-config/alliances/bulk-upload/:uploadId/confirm
     */
    @Post(':uploadId/confirm')
    @ApiOperation({ summary: 'Confirm and start import of valid Alliance records' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.alliance.create'))
    async confirmUpload(@Param('uploadId') uploadId: string, @GetUser('id') userId: string) {
        const result = await this.bulkUploadService.confirmUpload(uploadId, userId);
        return { status: true, message: 'Alliance import confirmed and started', data: result };
    }

    /**
     * SSE /api/pos-config/alliances/bulk-upload/:uploadId/events
     */
    @Sse(':uploadId/events')
    @ApiOperation({ summary: 'Stream Alliance bulk upload events (SSE)' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.alliance.read'))
    streamEvents(@Param('uploadId') uploadId: string): Observable<MessageEvent> {
        return this.eventsService.subscribe(uploadId);
    }

    /**
     * GET /api/pos-config/alliances/bulk-upload/:uploadId/status
     */
    @Get(':uploadId/status')
    @ApiOperation({ summary: 'Get Alliance upload status' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.alliance.read'))
    async getUploadStatus(@Param('uploadId') uploadId: string) {
        const status = await this.bulkUploadService.getUploadStatus(uploadId);
        return { status: true, data: status };
    }

    /**
     * DELETE /api/pos-config/alliances/bulk-upload/:uploadId
     */
    @Delete(':uploadId')
    @ApiOperation({ summary: 'Cancel Alliance upload' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.alliance.delete'))
    async cancelUpload(@Param('uploadId') uploadId: string) {
        await this.bulkUploadService.cancelUpload(uploadId);
        return { status: true, message: 'Alliance upload cancelled successfully' };
    }

    /**
     * GET /api/pos-config/alliances/bulk-upload/history/list
     */
    @Get('history/list')
    @ApiOperation({ summary: 'Get Alliance upload history' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.alliance.read'))
    async getUploadHistory(@GetUser('id') userId: string) {
        const history = await this.bulkUploadService.getUploadHistory(userId);
        return { status: true, data: history };
    }

    /**
     * GET /api/pos-config/alliances/bulk-upload/:uploadId/error-report
     */
    @Get(':uploadId/error-report')
    @ApiOperation({ summary: 'Download Alliance error report' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.alliance.read'))
    async downloadErrorReport(@Param('uploadId') uploadId: string, @Res() res: any) {
        const upload = await this.bulkUploadService.getUploadStatus(uploadId);
        const csv = this.bulkUploadService.generateErrorReport(upload.errors as any[]);
        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', `attachment; filename="alliance-upload-errors-${uploadId}.csv"`);
        return res.status(HttpStatus.OK).send(csv);
    }

    /**
     * GET /api/pos-config/alliances/bulk-upload/template/download
     */
    @Get('template/download')
    @ApiOperation({ summary: 'Download Alliance CSV template' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.alliance.read'))
    async downloadTemplate(@Res() res: any) {
        const template = [
            'S.No,Account Sequential Code,BANK,Discount Alliance Option Name,Expiry,Card BIN Numbers,Bank Card Name,Debit/Credit Cards,Discount Capping',
            '1,510001,HBL,HBL - 25% and Rs. 30000 Capping,10/31/2026,555699,HBL - World Elite Debit Card,Debit Card,Rs. 30000/-',
            '2,510001,HBL,HBL - 25% and Rs. 30000 Capping,10/31/2026,405048,HBL - World Elite Debit Card Platinum Dubai,Debit Card,Rs. 30000/-',
            '3,510002,HBL,HBL - 25% and Rs. 20000 Capping,10/31/2026,517420,HBL - World Debit Card,Debit Card,Rs. 20000/-',
            '4,510002,HBL,HBL - 25% and Rs. 20000 Capping,10/31/2026,490288,HBL - Platinum Credit Card,Credit Card,Rs. 20000/-',
        ].join('\n');
        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', 'attachment; filename="alliance-upload-template.csv"');
        return res.status(HttpStatus.OK).send(template);
    }
}
