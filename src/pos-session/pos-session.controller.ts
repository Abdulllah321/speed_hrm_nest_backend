import { Controller, Get, Put, Post, Body, Req, Query, UseGuards, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PosSessionService } from './pos-session.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import * as jwt from 'jsonwebtoken';

@ApiTags('POS Terminal Session')
@Controller('api/pos-session')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class PosSessionController {
    constructor(private readonly sessionService: PosSessionService) { }

    private extractTerminalContext(req: any) {
        const token = req.cookies?.posTerminalToken;
        if (!token) throw new UnauthorizedException('No terminal token found');

        try {
            const decoded: any = jwt.decode(token);
            if (!decoded || !decoded.terminalId || !decoded.posId || !decoded.locationId) {
                throw new UnauthorizedException('Invalid terminal token');
            }
            return {
                terminalId: decoded.terminalId, // UUID
                posId: decoded.posId, // Code (e.g. 001)
                locationId: decoded.locationId, // UUID
            };
        } catch (e) {
            throw new UnauthorizedException('Invalid terminal token format');
        }
    }

    @Get('current')
    @ApiOperation({ summary: 'Get current drawer status and cash metrics' })
    async getCurrentSession(@Req() req: any) {
        const { terminalId, posId, locationId } = this.extractTerminalContext(req);
        return this.sessionService.getCurrentSession(terminalId, posId, locationId);
    }

    @Put('current/open')
    @Permissions('pos.shift.open')
    @ApiOperation({ summary: 'Open the drawer by adding a float amount' })
    async openDrawer(
        @Req() req: any,
        @Body() body: { amount: number; note?: string },
    ) {
        const { terminalId } = this.extractTerminalContext(req);
        return this.sessionService.openDrawer(terminalId, body.amount, body.note);
    }

    @Post('current/close')
    @Permissions('pos.shift.close')
    @ApiOperation({ summary: 'Close the drawer and record counted variance' })
    async closeDrawer(
        @Req() req: any,
        @Body() body: { actualCash: number; note?: string },
    ) {
        const { terminalId, posId, locationId } = this.extractTerminalContext(req);
        return this.sessionService.closeDrawer(terminalId, posId, locationId, body.actualCash, body.note);
    }

    @Get('history')
    @ApiOperation({ summary: 'Get paginated shift history for this terminal' })
    async getSessionHistory(
        @Req() req: any,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        const { terminalId, posId } = this.extractTerminalContext(req);
        return this.sessionService.getSessionHistory(
            terminalId,
            posId,
            page ? parseInt(page, 10) : 1,
            limit ? parseInt(limit, 10) : 20,
        );
    }
}
