import {
  Controller,
  Get,
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PosDashboardService } from './pos-dashboard.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import * as jwt from 'jsonwebtoken';

@ApiTags('POS Dashboard')
@Controller('api/pos-dashboard')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PosDashboardController {
  constructor(private readonly posDashboardService: PosDashboardService) {}

  private extractLocationId(req: any): string {
    // 1. From combined POS user token (req.user populated by JwtAuthGuard)
    if (req.user?.locationId) return req.user.locationId;

    // 2. From dedicated terminal cookie
    const token = req.cookies?.posTerminalToken;
    if (token) {
      try {
        const decoded: any = jwt.decode(token);
        if (decoded?.locationId) return decoded.locationId;
      } catch (_) {}
    }

    throw new UnauthorizedException(
      'No active terminal context found. Please log in to a POS terminal.',
    );
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get POS dashboard stats for the active location' })
  async getStats(@Req() req: any) {
    const locationId = this.extractLocationId(req);
    const cashierUserId: string | undefined = req.user?.id;
    return this.posDashboardService.getDashboardStats(locationId, cashierUserId);
  }
}
