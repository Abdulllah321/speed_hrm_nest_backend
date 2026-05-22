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
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { HsCodeBulkUploadService } from './hs-code-bulk-upload.service';
import { GetUser } from '../../../common/decorators/get-user.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UploadEventsService } from '../../../finance/item/upload-events.service';
import { BaseBulkUploadController } from '../../../common/controllers/base-bulk-upload.controller';

@ApiTags('HS Code Bulk Upload')
@Controller('api/master/hs-codes/bulk-upload')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class HsCodeBulkUploadController extends BaseBulkUploadController {
    constructor(
        bulkUploadService: HsCodeBulkUploadService,
        eventsService: UploadEventsService,
    ) {
        super(bulkUploadService, eventsService, 'HS Code');
    }

    @Post()
    @ApiOperation({ summary: 'Upload HS Code file for validation' })
    @UseGuards(PermissionGuard('master.hs-code.create'))
    async uploadFile(@Req() req: any, @GetUser('id') userId: string) {
        return super.uploadFile(req, userId);
    }

    @Post(':uploadId/confirm')
    @ApiOperation({ summary: 'Confirm and start import of valid HS Code records' })
    @UseGuards(PermissionGuard('master.hs-code.create'))
    async confirmUpload(@Param('uploadId') uploadId: string, @GetUser('id') userId: string) {
        return super.confirmUpload(uploadId, userId);
    }

    @Sse(':uploadId/events')
    @ApiOperation({ summary: 'Stream HS Code bulk upload events (SSE)' })
    @UseGuards(PermissionGuard('master.hs-code.read'))
    streamEvents(@Param('uploadId') uploadId: string) {
        return super.streamEvents(uploadId);
    }

    @Get(':uploadId/status')
    @ApiOperation({ summary: 'Get HS Code upload status' })
    @UseGuards(PermissionGuard('master.hs-code.read'))
    async getUploadStatus(@Param('uploadId') uploadId: string) {
        return super.getUploadStatus(uploadId);
    }

    @Delete(':uploadId')
    @ApiOperation({ summary: 'Cancel HS Code upload' })
    @UseGuards(PermissionGuard('master.hs-code.delete'))
    async cancelUpload(@Param('uploadId') uploadId: string) {
        return super.cancelUpload(uploadId);
    }

    @Get('history/list')
    @ApiOperation({ summary: 'Get HS Code upload history' })
    @UseGuards(PermissionGuard('master.hs-code.read'))
    async getUploadHistory(@GetUser('id') userId: string) {
        return super.getUploadHistory(userId);
    }

    @Get(':uploadId/error-report')
    @ApiOperation({ summary: 'Download HS Code error report' })
    @UseGuards(PermissionGuard('master.hs-code.read'))
    async downloadErrorReport(@Param('uploadId') uploadId: string, @Res() res: any) {
        return super.downloadErrorReport(uploadId, res);
    }

    @Get('template/download')
    @ApiOperation({ summary: 'Download HS Code CSV template' })
    @UseGuards(PermissionGuard('master.hs-code.read'))
    async downloadTemplate(@Res() res: any) {
        const template = [
            'HS CODES,CD,RD,ACD,ST,AST,IT',
            '6404.1900,20%,32%,4%,25%,3%,6%',
            '4202.2200,20%,20%,4%,25%,3%,6%',
            '4202.2900,20%,20%,4%,25%,3%,6%',
            '4202.9200,20%,20%,4%,25%,3%,6%',
            '4203.3000,20%,40%,4%,25%,3%,6%',
            '9004.1000,-,24%,-,25%,-,6%',
            '4202.3100,20%,20%,4%,25%,3%,6%',
            '4202.3200,20%,20%,4%,25%,3%,6%',
            '6105.9000,20%,10%,4%,18%,3%,6%',
            '6103.4900,20%,10%,4%,18%,3%,6%',
        ].join('\n');
        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', 'attachment; filename="hscode-upload-template.csv"');
        return res.status(HttpStatus.OK).send(template);
    }
}
