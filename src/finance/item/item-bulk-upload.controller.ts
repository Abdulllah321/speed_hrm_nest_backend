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
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ItemBulkUploadService } from './item-bulk-upload.service';
import { GetUser } from '../../common/decorators/get-user.decorator';

@Controller('api/items/bulk-upload')
@UseGuards(JwtAuthGuard)
export class ItemBulkUploadController {
    constructor(private bulkUploadService: ItemBulkUploadService) { }

    /**
     * POST /api/items/bulk-upload
     * Upload CSV/Excel file and initiate bulk upload job
     */
    @Post()
    async uploadFile(
        @Req() req: any,
        @GetUser('id') userId: string,
    ) {
        const file = await req.file();
        if (!file) {
            throw new BadRequestException('No file uploaded');
        }

        // Validate file type
        const allowedExtensions = ['csv', 'xlsx', 'xls'];
        const ext = file.filename.split('.').pop()?.toLowerCase();

        if (!ext || !allowedExtensions.includes(ext)) {
            throw new BadRequestException(
                `Invalid file type. Allowed: ${allowedExtensions.join(', ')}`,
            );
        }

        // Get file buffer from stream
        const buffer = await file.toBuffer();

        // Validate file size (max 500MB)
        const maxSize = 500 * 1024 * 1024; // 500MB
        if (buffer.length > maxSize) {
            throw new BadRequestException('File size exceeds 500MB limit');
        }

        const result = await this.bulkUploadService.initiateUpload(
            buffer,
            file.filename,
            userId,
        );

        return {
            status: true,
            message: 'Upload initiated successfully',
            data: result,
        };
    }

    /**
     * GET /api/items/bulk-upload/:uploadId/status
     * Get upload progress and status
     */
    @Get(':uploadId/status')
    async getUploadStatus(@Param('uploadId') uploadId: string) {
        const status = await this.bulkUploadService.getUploadStatus(uploadId);

        return {
            status: true,
            data: status,
        };
    }

    /**
     * DELETE /api/items/bulk-upload/:uploadId
     * Cancel upload job
     */
    @Delete(':uploadId')
    async cancelUpload(@Param('uploadId') uploadId: string) {
        await this.bulkUploadService.cancelUpload(uploadId);

        return {
            status: true,
            message: 'Upload cancelled successfully',
        };
    }

    /**
     * GET /api/items/bulk-upload/history
     * Get upload history
     */
    @Get('history/list')
    async getUploadHistory(@GetUser('id') userId: string) {
        const history = await this.bulkUploadService.getUploadHistory(userId);

        return {
            status: true,
            data: history,
        };
    }

    /**
     * GET /api/items/bulk-upload/:uploadId/error-report
     * Download error report as CSV
     */
    @Get(':uploadId/error-report')
    async downloadErrorReport(
        @Param('uploadId') uploadId: string,
        @Res() res: Response,
    ) {
        const upload = await this.bulkUploadService.getUploadStatus(uploadId);
        const csv = this.bulkUploadService.generateErrorReport(upload.errors as any[]);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="upload-errors-${uploadId}.csv"`,
        );
        res.status(HttpStatus.OK).send(csv);
    }

    /**
     * GET /api/items/bulk-upload/template
     * Download CSV template
     */
    @Get('template/download')
    async downloadTemplate(@Res() res: Response) {
        const template = [
            'Concept,Description,FOB,UnitCost,UnitPrice,TaxRate1,TaxRate2,DiscountStartDate,DiscountEndDate,DiscountRate,DiscountAmount,IsActive,SKU,Size,Color,Division,Department,ProductCategory,Silhouette,Class,Subclass,Channel Class,Season,OldSeason,Gender,Case,Band,Movement Type,Heel Height,Width,HSCode,ItemID,BarCode,UOM,Segment',
            'Sample Concept,Sample Item Description,100,80,150,5,0,2024-01-01,2024-12-31,10,0,true,SKU-001,M,Red,Mens,Footwear,Shoes,Casual,Class A,Subclass 1,Retail,Summer,N/A,Male,N/A,Premium,Standard,Low,Medium,1234567890,ITEM-001,BAR-001,PC,Standard',
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader(
            'Content-Disposition',
            'attachment; filename="item-upload-template.csv"',
        );
        res.status(HttpStatus.OK).send(template);
    }
}
