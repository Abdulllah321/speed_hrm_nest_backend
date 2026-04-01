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
import { ItemBulkUploadService } from './item-bulk-upload.service';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UploadEventsService } from './upload-events.service';
import { Observable } from 'rxjs';

@ApiTags('ERP Items Bulk Upload')
@Controller('api/items/bulk-upload')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ItemBulkUploadController {
    constructor(
        private bulkUploadService: ItemBulkUploadService,
        private eventsService: UploadEventsService,
    ) { }

    /**
     * POST /api/items/bulk-upload
     * Upload CSV/Excel file and initiate validation
     */
    @Post()
    @ApiOperation({ summary: 'Upload file for validation' })
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
        const maxSize = 50 * 1024 * 1024; // Lowering to 50MB for better performance
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
            message: 'Validation initiated',
            data: result,
        };
    }

    /**
     * POST /api/items/bulk-upload/:uploadId/confirm
     * Confirm validation and start actual import
     */
    @Post(':uploadId/confirm')
    @ApiOperation({ summary: 'Confirm and start import of valid records' })
    async confirmUpload(
        @Param('uploadId') uploadId: string,
        @GetUser('id') userId: string,
    ) {
        const result = await this.bulkUploadService.confirmUpload(uploadId, userId);
        return {
            status: true,
            message: 'Import confirmed and started',
            data: result,
        };
    }

    /**
     * SSE /api/items/bulk-upload/:uploadId/events
     * Stream real-time progress events
     */
    @Sse(':uploadId/events')
    @ApiOperation({ summary: 'Stream bulk upload events (SSE)' })
    streamEvents(@Param('uploadId') uploadId: string): Observable<MessageEvent> {
        return this.eventsService.subscribe(uploadId);
    }

    /**
     * GET /api/items/bulk-upload/history
     */
    @Get('history/list')
    @ApiOperation({ summary: 'Get upload history' })
    async getUploadHistory(@GetUser('id') userId: string) {
        const history = await this.bulkUploadService.getUploadHistory(userId);
        return {
            status: true,
            data: history,
        };
    }

    @Get('template/download')
    @ApiOperation({ summary: 'Download CSV template' })
    async downloadTemplate(@Res() res: any) {
        const template = [
            'Concept,ItemID,SKU,BarCode,Description,UnitPrice,TaxRate1,TaxRate2,DiscountRate,DiscountAmount,DiscountStartDate,DiscountEndDate,IsActive,Concept,Size,Color,Division,Department,ProductCategory,Silhouette,Class,Subclass,Channel Class,Season,OldSeason,Gender,Case,Band,Movement Type,Heel Height,Width,HSCode,UOM,Segment',
            'Sample,ITEM-001,SKU-001,BAR-001,Description,150,5,0,0,0,,,true,BrandX,M,Red,Mens,Footwear,Shoes,Casual,ClassA,Subclass1,Retail,Summer 2024,N/A,Male,N/A,Premium,Standard,Low,Medium,1234,PC,Standard',
        ].join('\n');
        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', 'attachment; filename="item-upload-template.csv"');
        return res.status(HttpStatus.OK).send(template);
    }

    // ── Param routes last — static routes above must be declared first ──────

    @Get(':uploadId/status')
    @ApiOperation({ summary: 'Get upload status' })
    async getUploadStatus(@Param('uploadId') uploadId: string) {
        const status = await this.bulkUploadService.getUploadStatus(uploadId);
        return {
            status: true,
            data: status,
        };
    }

    @Delete(':uploadId')
    @ApiOperation({ summary: 'Cancel upload' })
    async cancelUpload(@Param('uploadId') uploadId: string) {
        await this.bulkUploadService.cancelUpload(uploadId);
        return {
            status: true,
            message: 'Upload cancelled successfully',
        };
    }

    // More specific sub-paths before less specific ones
    @Get(':uploadId/error-report')
    @ApiOperation({ summary: 'Download error report (streamed CSV) or check readiness via ?prepare=true' })
    async downloadErrorReport(
        @Param('uploadId') uploadId: string,
        @Res() res: any,
        @Req() req: any,
    ) {
        // ?prepare=true → JSON response to check readiness / kick off generation
        if (req.query?.prepare === 'true') {
            const result = await this.bulkUploadService.prepareErrorReport(uploadId);
            if (!result.ready) {
                await this.bulkUploadService.regenerateErrorReport(uploadId).catch(() => {});
            }
            res.header('Content-Type', 'application/json');
            res.send({ status: true, data: result });
            return;
        }

        await this.bulkUploadService.streamErrorReport(uploadId, res);
    }
}
