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
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { CoaBulkUploadService } from './coa-bulk-upload.service';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UploadEventsService } from '../item/upload-events.service';
import { Observable } from 'rxjs';

@ApiTags('Chart of Accounts Bulk Upload')
@Controller('api/finance/chart-of-accounts/bulk-upload')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CoaBulkUploadController {
    constructor(
        private bulkUploadService: CoaBulkUploadService,
        private eventsService: UploadEventsService,
    ) { }

    /**
     * POST /api/finance/chart-of-accounts/bulk-upload
     * Upload CSV/Excel file and initiate validation
     */
    @Post()
    @ApiOperation({ summary: 'Upload Chart of Accounts file for validation' })
    @UseGuards(JwtAuthGuard, PermissionGuard('finance.chart-of-account.create'))
    async uploadFile(
        @Req() req: any,
        @GetUser('id') userId: string,
    ) {
        const file = await req.file();
        if (!file) {
            throw new BadRequestException('No file uploaded');
        }

        const allowedExtensions = ['csv', 'xlsx', 'xls'];
        const ext = file.filename.split('.').pop()?.toLowerCase();

        if (!ext || !allowedExtensions.includes(ext)) {
            throw new BadRequestException(`Invalid file type. Allowed: ${allowedExtensions.join(', ')}`);
        }

        const buffer = await file.toBuffer();
        const maxSize = 50 * 1024 * 1024; // 50MB limit
        if (buffer.length > maxSize) {
            throw new BadRequestException('File size exceeds 50MB limit');
        }

        const result = await this.bulkUploadService.initiateValidation(
            buffer,
            file.filename,
            userId,
        );

        return {
            status: true,
            message: 'Chart of Accounts validation initiated',
            data: result,
        };
    }

    /**
     * POST /api/finance/chart-of-accounts/bulk-upload/:uploadId/confirm
     * Confirm validation and start actual import
     */
    @Post(':uploadId/confirm')
    @ApiOperation({ summary: 'Confirm and start import of valid COA records' })
    @UseGuards(JwtAuthGuard, PermissionGuard('finance.chart-of-account.create'))
    async confirmUpload(
        @Param('uploadId') uploadId: string,
        @GetUser('id') userId: string,
    ) {
        const result = await this.bulkUploadService.confirmUpload(uploadId, userId);
        return {
            status: true,
            message: 'Chart of Accounts import confirmed and started',
            data: result,
        };
    }

    /**
     * SSE /api/finance/chart-of-accounts/bulk-upload/:uploadId/events
     * Stream real-time progress events
     */
    @Sse(':uploadId/events')
    @ApiOperation({ summary: 'Stream COA bulk upload events (SSE)' })
    @UseGuards(JwtAuthGuard, PermissionGuard('finance.chart-of-account.read'))
    streamEvents(@Param('uploadId') uploadId: string): Observable<MessageEvent> {
        return this.eventsService.subscribe(uploadId);
    }

    /**
     * GET /api/finance/chart-of-accounts/bulk-upload/:uploadId/status
     * Get current status (polling fallback)
     */
    @Get(':uploadId/status')
    @ApiOperation({ summary: 'Get COA upload status' })
    @UseGuards(JwtAuthGuard, PermissionGuard('finance.chart-of-account.read'))
    async getUploadStatus(@Param('uploadId') uploadId: string) {
        const status = await this.bulkUploadService.getUploadStatus(uploadId);
        return {
            status: true,
            data: status,
        };
    }

    /**
     * DELETE /api/finance/chart-of-accounts/bulk-upload/:uploadId
     * Cancel job
     */
    @Delete(':uploadId')
    @ApiOperation({ summary: 'Cancel COA upload' })
    @UseGuards(JwtAuthGuard, PermissionGuard('finance.chart-of-account.delete'))
    async cancelUpload(@Param('uploadId') uploadId: string) {
        await this.bulkUploadService.cancelUpload(uploadId);
        return {
            status: true,
            message: 'Chart of Accounts upload cancelled successfully',
        };
    }

    /**
     * GET /api/finance/chart-of-accounts/bulk-upload/history
     */
    @Get('history/list')
    @ApiOperation({ summary: 'Get COA upload history' })
    @UseGuards(JwtAuthGuard, PermissionGuard('finance.chart-of-account.read'))
    async getUploadHistory(@GetUser('id') userId: string) {
        const history = await this.bulkUploadService.getUploadHistory(userId);
        return {
            status: true,
            data: history,
        };
    }

    @Get(':uploadId/error-report')
    @ApiOperation({ summary: 'Download COA error report' })
    @UseGuards(JwtAuthGuard, PermissionGuard('finance.chart-of-account.read'))
    async downloadErrorReport(
        @Param('uploadId') uploadId: string,
        @Res() res: any,
    ) {
        const upload = await this.bulkUploadService.getUploadStatus(uploadId);
        const csv = this.bulkUploadService.generateErrorReport(upload.errors as any[]);
        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', `attachment; filename="coa-upload-errors-${uploadId}.csv"`);
        return res.status(HttpStatus.OK).send(csv);
    }

    @Get('template/download')
    @ApiOperation({ summary: 'Download COA CSV template' })
    @UseGuards(JwtAuthGuard, PermissionGuard('finance.chart-of-account.read'))
    async downloadTemplate(@Res() res: any) {
        const template = [
            'CODE,MAIN,DEBIT,CREDIT,CODE,CONTROL ACCOUNT,DEBIT,CREDIT,CODE,SUB CONTROL ACCOUNT,DEBIT,CREDIT,CODE,TAG ID,GL DESCRIPTION,DEBIT,CREDIT',
            '1,CAPITAL,-,1671498040,10,SHARE HOLDERS\' EQUITY,-,1671498040,1001,SHARE CAPITAL & RESERVES,-,363111685,10010001,,AUTHORIZED CAPITAL,-,73370900',
            ',,,,,,,,,,,,,,DIR001,MUHAMMAD GHOUSE AKBAR,-,35480000',
            ',,,,,,,,,,,,,,DIR002,ADIL MATCHESWALA,-,11500000',
            ',,,,,,,,,,,,10010002,,SHARE PREMIUM,-,289740785',
            ',,,,,,,,1002,UN APPROPRIATED PROFIT/(LOSS),-,2269521093,10020001,,UN APPROPRIATED PROFIT/(LOSS),-,2269521093',
            ',,,,,,,,,,,,10020002,,DIVIDEND,961134738,-',
        ].join('\n');
        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', 'attachment; filename="coa-upload-template.csv"');
        return res.status(HttpStatus.OK).send(template);
    }
}
