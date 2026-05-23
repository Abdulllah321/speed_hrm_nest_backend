import {
    Controller,
    Post,
    Get,
    Delete,
    Param,
    UseGuards,
    Res,
    HttpStatus,
    Req,
    Sse,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ItemUpdateBulkUploadService } from './item-update-bulk-upload.service';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UploadEventsService } from './upload-events.service';
import { BaseBulkUploadController } from '../../common/controllers/base-bulk-upload.controller';

@ApiTags('ERP Items Price & Tax Bulk Update')
@Controller('api/items/bulk-update-prices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ItemUpdateBulkUploadController extends BaseBulkUploadController {
    constructor(
        bulkUploadService: ItemUpdateBulkUploadService,
        eventsService: UploadEventsService,
    ) {
        super(bulkUploadService, eventsService, 'Item Price & Tax');
    }

    @Post()
    @ApiOperation({ summary: 'Upload price/tax update file for validation' })
    @Permissions('erp.item.update')
    override async uploadFile(@Req() req: any, @GetUser('id') userId: string) {
        return super.uploadFile(req, userId);
    }

    @Post(':uploadId/confirm')
    @ApiOperation({ summary: 'Confirm and start import of valid price/tax updates' })
    @Permissions('erp.item.update')
    override async confirmUpload(@Param('uploadId') uploadId: string, @GetUser('id') userId: string) {
        return super.confirmUpload(uploadId, userId);
    }

    @Sse(':uploadId/events')
    @ApiOperation({ summary: 'Stream price/tax update bulk upload events (SSE)' })
    @Permissions('erp.item.read')
    override streamEvents(@Param('uploadId') uploadId: string) {
        return super.streamEvents(uploadId);
    }

    @Get(':uploadId/status')
    @ApiOperation({ summary: 'Get price/tax update upload status' })
    @Permissions('erp.item.read')
    override async getUploadStatus(@Param('uploadId') uploadId: string) {
        return super.getUploadStatus(uploadId);
    }

    @Delete(':uploadId')
    @ApiOperation({ summary: 'Cancel price/tax update upload' })
    @Permissions('erp.item.update')
    override async cancelUpload(@Param('uploadId') uploadId: string) {
        return super.cancelUpload(uploadId);
    }

    @Get('history/list')
    @ApiOperation({ summary: 'Get price/tax update upload history' })
    @Permissions('erp.item.read')
    override async getUploadHistory(@GetUser('id') userId: string) {
        return super.getUploadHistory(userId);
    }

    @Get(':uploadId/error-report')
    @ApiOperation({ summary: 'Download price/tax update error report' })
    @Permissions('erp.item.read')
    override async downloadErrorReport(@Param('uploadId') uploadId: string, @Res() res: any) {
        return super.downloadErrorReport(uploadId, res);
    }

    @Get('template/download')
    @ApiOperation({ summary: 'Download price/tax update CSV template' })
    @Permissions('erp.item.read')
    async downloadTemplate(@Res() res: any) {
        const template = [
            'Barcode,Sale Price,FOB,Sales Tax Rate,Additional Sales Tax',
            'BAR-001,200.00,12.50,5,0',
            'BAR-002,150.00,10.00,5,0',
        ].join('\n');
        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', 'attachment; filename="item-update-prices-template.csv"');
        return res.status(HttpStatus.OK).send(template);
    }
}
