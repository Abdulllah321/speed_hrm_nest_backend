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
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AllianceBulkUploadService } from './alliance-bulk-upload.service';
import { GetUser } from '../common/decorators/get-user.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UploadEventsService } from '../finance/item/upload-events.service';
import { BaseBulkUploadController } from '../common/controllers/base-bulk-upload.controller';

@ApiTags('Alliance Bulk Upload')
@Controller('api/pos-config/alliances/bulk-upload')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AllianceBulkUploadController extends BaseBulkUploadController {
    constructor(
        bulkUploadService: AllianceBulkUploadService,
        eventsService: UploadEventsService,
    ) {
        super(bulkUploadService, eventsService, 'Alliance');
    }

    @Post()
    @ApiOperation({ summary: 'Upload Alliance Discount file for validation' })
    @UseGuards(PermissionGuard('master.alliance.create'))
    async uploadFile(@Req() req: any, @GetUser('id') userId: string) {
        return super.uploadFile(req, userId);
    }

    @Post(':uploadId/confirm')
    @ApiOperation({ summary: 'Confirm and start import of valid Alliance records' })
    @UseGuards(PermissionGuard('master.alliance.create'))
    async confirmUpload(@Param('uploadId') uploadId: string, @GetUser('id') userId: string) {
        return super.confirmUpload(uploadId, userId);
    }

    @Sse(':uploadId/events')
    @ApiOperation({ summary: 'Stream Alliance bulk upload events (SSE)' })
    @UseGuards(PermissionGuard('master.alliance.read'))
    streamEvents(@Param('uploadId') uploadId: string) {
        return super.streamEvents(uploadId);
    }

    @Get(':uploadId/status')
    @ApiOperation({ summary: 'Get Alliance upload status' })
    @UseGuards(PermissionGuard('master.alliance.read'))
    async getUploadStatus(@Param('uploadId') uploadId: string) {
        return super.getUploadStatus(uploadId);
    }

    @Delete(':uploadId')
    @ApiOperation({ summary: 'Cancel Alliance upload' })
    @UseGuards(PermissionGuard('master.alliance.delete'))
    async cancelUpload(@Param('uploadId') uploadId: string) {
        return super.cancelUpload(uploadId);
    }

    @Get('history/list')
    @ApiOperation({ summary: 'Get Alliance upload history' })
    @UseGuards(PermissionGuard('master.alliance.read'))
    async getUploadHistory(@GetUser('id') userId: string) {
        return super.getUploadHistory(userId);
    }

    @Get(':uploadId/error-report')
    @ApiOperation({ summary: 'Download Alliance error report' })
    @UseGuards(PermissionGuard('master.alliance.read'))
    async downloadErrorReport(@Param('uploadId') uploadId: string, @Res() res: any) {
        return super.downloadErrorReport(uploadId, res);
    }

    @Get('template/download')
    @ApiOperation({ summary: 'Download Alliance CSV template' })
    @UseGuards(PermissionGuard('master.alliance.read'))
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
