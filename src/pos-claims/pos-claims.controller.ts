import { Controller, Get, Post, Param, Body, Query, UseGuards, Req, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PosClaimsService } from './pos-claims.service';
import { ClaimRegisterExportService } from './claim-register-export.service';

@ApiTags('POS Claims')
@Controller('api/pos-claims')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PosClaimsController {
    constructor(
        private readonly service: PosClaimsService,
        private readonly claimRegisterExportService: ClaimRegisterExportService,
    ) { }

    @Post()
    @ApiOperation({ summary: 'Submit a new POS return claim' })
    create(@Body() dto: any, @Req() req: any) {
        return this.service.create(dto, req.user?.id, {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }

    @Get()
    @ApiOperation({ summary: 'List all claims' })
    findAll(
        @Query('status') status?: string,
        @Query('limit') limit?: string,
        @Query('page') page?: string,
    ) {
        return this.service.findAll({
            status,
            limit: limit ? parseInt(limit) : 50,
            page: page ? parseInt(page) : 1,
        });
    }

    @Get('reports/claim-register')
    @ApiOperation({ summary: 'Get claim register report preview data' })
    async getClaimRegisterReport(
        @Query('locationId') locationId?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('search') search?: string,
    ) {
        const data = await this.claimRegisterExportService.getReportData({
            locationId,
            startDate,
            endDate,
            search,
        });
        return { status: true, data };
    }

    @Post('reports/claim-register/export')
    @ApiOperation({ summary: 'Queue background export job for claim register' })
    async queueClaimRegisterExport(@Body() body: any, @Req() req: any) {
        const result = await this.claimRegisterExportService.queueExport({
            userId: req.user?.id,
            locationId: body.locationId,
            startDate: body.startDate,
            endDate: body.endDate,
            format: body.format || 'xlsx',
            search: body.search,
        });
        return { status: true, data: result };
    }

    @Get('reports/claim-register/export-status/:jobId')
    @ApiOperation({ summary: 'Get export job status and progress' })
    async getClaimRegisterExportStatus(@Param('jobId') jobId: string) {
        const result = await this.claimRegisterExportService.getJobStatus(jobId);
        return { status: true, data: result };
    }

    @Get('reports/claim-register/export-download/:jobId')
    @ApiOperation({ summary: 'Download completed claim register export file' })
    async streamClaimRegisterExportFile(@Param('jobId') jobId: string, @Res() res: any) {
        return this.claimRegisterExportService.streamExportFile(jobId, res);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get claim detail' })
    findOne(@Param('id') id: string) {
        return this.service.findOne(id);
    }

    @Post(':id/start-review')
    @ApiOperation({ summary: 'Move claim to UNDER_REVIEW' })
    startReview(@Param('id') id: string, @Req() req: any) {
        return this.service.startReview(id, req.user?.id, {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }

    @Post(':id/review')
    @ApiOperation({ summary: 'Submit review decision (approve/reject per item)' })
    submitReview(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
        return this.service.submitReview(id, dto, req.user?.id, {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }

    @Post(':id/cancel')
    @ApiOperation({ summary: 'Cancel a claim' })
    cancel(@Param('id') id: string, @Req() req: any) {
        return this.service.cancel(id, {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }

    @Post(':id/reject')
    @ApiOperation({ summary: 'Reject a claim completely' })
    rejectClaim(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
        return this.service.rejectClaim(id, dto, req.user?.id, {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }
}
