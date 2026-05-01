import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ActivityLogsService } from './activity-logs.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('api/activity-logs')
@UseGuards(JwtAuthGuard)
export class ActivityLogsController {
  constructor(private readonly activityLogsService: ActivityLogsService,) {}

  @Get('filters')
  getFilters() {
    return this.activityLogsService.getFilters();
  }

  @Get()
  findAll(@Query() query: any) {
    return this.activityLogsService.findAll(query);
  }
}
