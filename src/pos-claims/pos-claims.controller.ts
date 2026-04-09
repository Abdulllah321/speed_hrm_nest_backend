import { Controller, Get, Post, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PosClaimsService } from './pos-claims.service';

@ApiTags('POS Claims')
@Controller('api/pos-claims')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PosClaimsController {
    constructor(private readonly service: PosClaimsService) { }

    @Post()
    @ApiOperation({ summary: 'Submit a new POS return claim' })
    create(@Body() dto: any, @Req() req: any) {
        return this.service.create(dto, req.user?.id);
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

    @Get(':id')
    @ApiOperation({ summary: 'Get claim detail' })
    findOne(@Param('id') id: string) {
        return this.service.findOne(id);
    }

    @Post(':id/start-review')
    @ApiOperation({ summary: 'Move claim to UNDER_REVIEW' })
    startReview(@Param('id') id: string, @Req() req: any) {
        return this.service.startReview(id, req.user?.id);
    }

    @Post(':id/review')
    @ApiOperation({ summary: 'Submit review decision (approve/reject per item)' })
    submitReview(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
        return this.service.submitReview(id, dto, req.user?.id);
    }

    @Post(':id/cancel')
    @ApiOperation({ summary: 'Cancel a claim' })
    cancel(@Param('id') id: string) {
        return this.service.cancel(id);
    }
}
