import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

// Prefix with `api` to align with frontend base URL (`/api`)
@Controller('api/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) { }

  @Get('stats')
  @UseGuards(JwtAuthGuard)
  async getStats() {
    return this.dashboardService.getDashboardStats();
  }

  @Get('employee-stats')
  @UseGuards(JwtAuthGuard)
  async getEmployeeStats(@Request() req) {
    return this.dashboardService.getEmployeeDashboardStats(req.user.userId);
  }
}
