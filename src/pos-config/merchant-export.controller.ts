import {
    Controller,
    Post,
    Get,
    Param,
    Query,
    Res,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { GetUser } from '../common/decorators/get-user.decorator';
import { MerchantExportService } from './merchant-export.service';

@ApiTags('Merchant Export')
@Controller('api/pos-config/merchants/export')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MerchantExportController {
    constructor(private readonly exportService: MerchantExportService) { }

    /**
     * POST /api/pos-config/merchants/export
     * Queues a background export job. Returns immediately with a jobId.
     * User receives an in-app notification when the file is ready.
     */
    @Post()
    @UseGuards(JwtAuthGuard, PermissionGuard('master.merchant.read'))
    @ApiOperation({ summary: 'Queue a merchant export job (returns immediately, notifies when done)' })
    async queueExport(
        @GetUser('id') userId: string,
        @Query('search') search?: string,
        @Query('locationId') locationId?: string,
        @Query('bankName') bankName?: string,
        @Query('isActive') isActive?: string,
    ) {
        const isActiveBool = isActive === undefined ? undefined : (isActive === 'true' || isActive === '1');

        const result = await this.exportService.queueExport({
            userId,
            search,
            locationId,
            bankName,
            isActive: isActiveBool,
        });

        return {
            status: true,
            message: "Export queued. You'll receive a notification when your file is ready.",
            data: result,
        };
    }

    /**
     * GET /api/pos-config/merchants/export/:jobId/status
     */
    @Get(':jobId/status')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.merchant.read'))
    @ApiOperation({ summary: 'Check merchant export job status' })
    async getStatus(@Param('jobId') jobId: string) {
        const result = await this.exportService.getJobStatus(jobId);
        return { status: true, data: result };
    }

    /**
     * GET /api/pos-config/merchants/export/:jobId/download
     * Streams the completed Excel file. Auto-deletes after download.
     */
    @Get(':jobId/download')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.merchant.read'))
    @ApiOperation({ summary: 'Download a completed merchant export file' })
    async download(@Param('jobId') jobId: string, @Res() res: any) {
        try {
            await this.exportService.streamExportFile(jobId, res);
        } catch (err: any) {
            const status = err?.status ?? 404;
            res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
        }
    }
}
