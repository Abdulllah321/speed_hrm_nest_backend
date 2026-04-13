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
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { HsCodeBulkUploadService } from './hs-code-bulk-upload.service';
import { GetUser } from '../../../common/decorators/get-user.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UploadEventsService } from '../../../finance/item/upload-events.service';
import { Observable } from 'rxjs';

@ApiTags('HS Code Bulk Upload')
@Controller('api/master/hs-codes/bulk-upload')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class HsCodeBulkUploadController {
    constructor(
        private bulkUploadService: HsCodeBulkUploadService,
        private eventsService: UploadEventsService,
    ) { }

    /**
     * POST /api/master/hs-codes/bulk-upload
     * Upload CSV/Excel file and initiate validation
     */
    @Post()
    @ApiOperation({ summary: 'Upload HS Code file for validation' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.hs-code.create'))
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
            message: 'HS Code validation initiated',
            data: result,
        };
    }

    /**
     * POST /api/master/hs-codes/bulk-upload/:uploadId/confirm
     * Confirm validation and start actual import
     */
    @Post(':uploadId/confirm')
    @ApiOperation({ summary: 'Confirm and start import of valid HS Code records' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.hs-code.create'))
    async confirmUpload(
        @Param('uploadId') uploadId: string,
        @GetUser('id') userId: string,
    ) {
        const result = await this.bulkUploadService.confirmUpload(uploadId, userId);
        return {
            status: true,
            message: 'HS Code import confirmed and started',
            data: result,
        };
    }

    /**
     * SSE /api/master/hs-codes/bulk-upload/:uploadId/events
     * Stream real-time progress events
     */
    @Sse(':uploadId/events')
    @ApiOperation({ summary: 'Stream HS Code bulk upload events (SSE)' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.hs-code.read'))
    streamEvents(@Param('uploadId') uploadId: string): Observable<MessageEvent> {
        return this.eventsService.subscribe(uploadId);
    }

    /**
     * GET /api/master/hs-codes/bulk-upload/:uploadId/status
     * Get current status (polling fallback)
     */
    @Get(':uploadId/status')
    @ApiOperation({ summary: 'Get HS Code upload status' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.hs-code.read'))
    async getUploadStatus(@Param('uploadId') uploadId: string) {
        const status = await this.bulkUploadService.getUploadStatus(uploadId);
        return {
            status: true,
            data: status,
        };
    }

    /**
     * DELETE /api/master/hs-codes/bulk-upload/:uploadId
     * Cancel job
     */
    @Delete(':uploadId')
    @ApiOperation({ summary: 'Cancel HS Code upload' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.hs-code.delete'))
    async cancelUpload(@Param('uploadId') uploadId: string) {
        await this.bulkUploadService.cancelUpload(uploadId);
        return {
            status: true,
            message: 'HS Code upload cancelled successfully',
        };
    }

    /**
     * GET /api/master/hs-codes/bulk-upload/history
     */
    @Get('history/list')
    @ApiOperation({ summary: 'Get HS Code upload history' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.hs-code.read'))
    async getUploadHistory(@GetUser('id') userId: string) {
        const history = await this.bulkUploadService.getUploadHistory(userId);
        return {
            status: true,
            data: history,
        };
    }

    @Get(':uploadId/error-report')
    @ApiOperation({ summary: 'Download HS Code error report' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.hs-code.read'))
    async downloadErrorReport(
        @Param('uploadId') uploadId: string,
        @Res() res: any,
    ) {
        const upload = await this.bulkUploadService.getUploadStatus(uploadId);
        const csv = this.bulkUploadService.generateErrorReport(upload.errors as any[]);
        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', `attachment; filename="hscode-upload-errors-${uploadId}.csv"`);
        return res.status(HttpStatus.OK).send(csv);
    }

    @Get('template/download')
    @ApiOperation({ summary: 'Download HS Code CSV template' })
    @UseGuards(JwtAuthGuard, PermissionGuard('master.hs-code.read'))
    async downloadTemplate(@Res() res: any) {
        const template = [
            'HS CODES,CD,RD,ACD,ST,IT',
            '6404.1900,20%,32%,4%,25%,6%',
            '4202.2200,20%,20%,4%,25%,6%',
            '4202.2900,20%,20%,4%,25%,6%',
            '4202.9200,20%,20%,4%,25%,6%',
            '4203.3000,20%,40%,4%,25%,6%',
            '9004.1000,-,24%,-,25%,6%',
            '4202.3100,20%,20%,4%,25%,6%',
            '4202.3200,20%,20%,4%,25%,6%',
            '6105.9000,20%,10%,4%,18%,6%',
            '6103.4900,20%,10%,4%,18%,6%',
        ].join('\n');
        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', 'attachment; filename="hscode-upload-template.csv"');
        return res.status(HttpStatus.OK).send(template);
    }
}
