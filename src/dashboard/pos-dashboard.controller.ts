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
  constructor(private readonly posDashboardService: PosDashboardService) { }

  private extractLocationFromCookie(req: any): string | undefined {
    if (req.cookies?.posTerminalToken) {
      try {
        const decoded: any = jwt.decode(req.cookies.posTerminalToken);
        return decoded?.locationId;
      } catch (e) {
        return undefined;
      }
    }
    return undefined;
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get POS dashboard stats for the active location' })
  async getStats(@Req() req: any) {
    const locationId = req.user?.locationId || this.extractLocationFromCookie(req);
    const cashierUserId: string | undefined = req.user?.id;
    console.log("===============================")
    console.log(locationId)
    console.log("===============================")
    return this.posDashboardService.getDashboardStats(locationId, cashierUserId);
  }
}
