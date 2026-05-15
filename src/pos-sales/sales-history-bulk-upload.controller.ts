import {
    Controller,
    Post,
    Get,
    Delete,
    Param,
    UseGuards,
    HttpStatus,
    BadRequestException,
    Req,
    Sse,
    MessageEvent,
    Res,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { SalesHistoryBulkUploadService } from './sales-history-bulk-upload.service';
import { GetUser } from '../common/decorators/get-user.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UploadEventsService } from '../finance/item/upload-events.service';
import { Observable } from 'rxjs';
import * as jwt from 'jsonwebtoken';

@ApiTags('Sales History Bulk Upload')
@Controller('api/pos-sales/bulk-upload')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class SalesHistoryBulkUploadController {
    constructor(
        private readonly bulkUploadService: SalesHistoryBulkUploadService,
        private readonly eventsService: UploadEventsService,
    ) {}

    /** Extract posId, terminalId, locationId from the posTerminalToken cookie */
    private extractTerminalContext(req: any): { posId?: string; terminalId?: string; locationId?: string } {
        const token = req.cookies?.posTerminalToken;
        if (!token) return {};
        try {
            const decoded: any = jwt.decode(token);
            return {
                posId: decoded?.posId || decoded?.terminalCode,
                terminalId: decoded?.terminalId,
                locationId: decoded?.locationId,
            };
        } catch {
            return {};
        }
    }

    /**
     * POST /api/pos-sales/bulk-upload
     * Upload CSV/Excel file and initiate validation
     */
    @Post()
    @Permissions('pos.sales.history.import')
    @ApiOperation({ summary: 'Upload sales history file for validation' })
    async uploadFile(@Req() req: any, @GetUser('id') userId: string) {
        const file = await req.file();
        if (!file) throw new BadRequestException('No file uploaded');

        const allowedExtensions = ['csv', 'xlsx', 'xls'];
        const ext = file.filename.split('.').pop()?.toLowerCase();
        if (!ext || !allowedExtensions.includes(ext)) {
            throw new BadRequestException(`Invalid file type. Allowed: ${allowedExtensions.join(', ')}`);
        }

        const buffer = await file.toBuffer();
        const maxSize = 100 * 1024 * 1024; // 100 MB — sales history files can be large
        if (buffer.length > maxSize) {
            throw new BadRequestException('File size exceeds 100MB limit');
        }

        const terminalCtx = this.extractTerminalContext(req);
        const result = await this.bulkUploadService.initiateValidation(
            buffer,
            file.filename,
            userId,
            terminalCtx,
        );
        return { status: true, message: 'Sales history validation initiated', data: result };
    }

    /**
     * POST /api/pos-sales/bulk-upload/:uploadId/confirm
     */
    @Post(':uploadId/confirm')
    @Permissions('pos.sales.history.import')
    @ApiOperation({ summary: 'Confirm and start import of valid sales history records' })
    async confirmUpload(
        @Param('uploadId') uploadId: string,
        @GetUser('id') userId: string,
        @Req() req: any,
    ) {
        const terminalCtx = this.extractTerminalContext(req);
        const result = await this.bulkUploadService.confirmUpload(uploadId, userId, terminalCtx);
        return { status: true, message: 'Sales history import confirmed and started', data: result };
    }

    /**
     * SSE /api/pos-sales/bulk-upload/:uploadId/events
     */
    @Sse(':uploadId/events')
    @ApiOperation({ summary: 'Stream sales history upload events (SSE)' })
    streamEvents(@Param('uploadId') uploadId: string): Observable<MessageEvent> {
        return this.eventsService.subscribe(uploadId);
    }

    /**
     * GET /api/pos-sales/bulk-upload/history/list
     */
    @Get('history/list')
    @Permissions('pos.sales.history.import')
    @ApiOperation({ summary: 'Get sales history upload history' })
    async getUploadHistory(@GetUser('id') userId: string) {
        const history = await this.bulkUploadService.getUploadHistory(userId);
        return { status: true, data: history };
    }

    /**
     * GET /api/pos-sales/bulk-upload/template/download
     */
    @Get('template/download')
    @Permissions('pos.sales.history.import')
    @ApiOperation({ summary: 'Download sales history CSV template' })
    async downloadTemplate(@Res() res: any) {
        const template = [
            'DocumentNumber,DocumentDate,BarCode,Quantity,UnitPrice,DiscountAmount,DiscountRate_Given,Sales Tax,Value Incl Sales Tax,CashSale,CardSale,GiftVoucherAmount,CreditVoucherAmount,ExchangeVoucherAmount,OnCreditAmount,FBR Invoice#,POS ID,CostCentre,Remarks,Is Alliance Discount,SalesPerson',
            'Sale1,7/1/2025,4067890000000,1,23400,4680,20,3744,18720,18721,0,0,0,0,0,136253EG1K49262428,136253,Speed Sports-Dolmen Clifton,,N,M. Danish',
            'Sale2,7/1/2025,4065420000000,1,17300,3460,20,2768,13840,13841,0,0,0,0,0,136253EG1K5944083,136253,Speed Sports-Dolmen Clifton,,N,Ahmed Sikander Javed',
        ].join('\n');
        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', 'attachment; filename="sales-history-upload-template.csv"');
        return res.status(HttpStatus.OK).send(template);
    }

    // ── Param routes last ──────────────────────────────────────────────────

    /**
     * GET /api/pos-sales/bulk-upload/:uploadId/status
     */
    @Get(':uploadId/status')
    @Permissions('pos.sales.history.import')
    @ApiOperation({ summary: 'Get sales history upload status' })
    async getUploadStatus(@Param('uploadId') uploadId: string) {
        const status = await this.bulkUploadService.getUploadStatus(uploadId);
        return { status: true, data: status };
    }

    /**
     * GET /api/pos-sales/bulk-upload/:uploadId/error-report
     */
    @Get(':uploadId/error-report')
    @Permissions('pos.sales.history.import')
    @ApiOperation({ summary: 'Download error report CSV' })
    async downloadErrorReport(@Param('uploadId') uploadId: string, @Res() res: any) {
        const upload = await this.bulkUploadService.getUploadStatus(uploadId);
        const csv = this.bulkUploadService.generateErrorReport(upload.errors as any[]);
        res.header('Content-Type', 'text/csv');
        res.header(
            'Content-Disposition',
            `attachment; filename="sales-history-errors-${uploadId}.csv"`,
        );
        return res.status(HttpStatus.OK).send(csv);
    }

    /**
     * DELETE /api/pos-sales/bulk-upload/:uploadId
     */
    @Delete(':uploadId')
    @Permissions('pos.sales.history.import')
    @ApiOperation({ summary: 'Cancel sales history upload' })
    async cancelUpload(@Param('uploadId') uploadId: string) {
        await this.bulkUploadService.cancelUpload(uploadId);
        return { status: true, message: 'Sales history upload cancelled' };
    }
}
