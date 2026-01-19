import {
  Controller,
  Get,
  Put,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Notifications')
@Controller('api/notifications')
export class NotificationsController {
  constructor(private service: NotificationsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List notifications for current user' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  async list(
    @Req() req: any,
    @Query('status') status?: 'unread' | 'read',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.list(req.user?.userId, {
      status,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Put(':id/read')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark a notification as read' })
  async markRead(@Req() req: any, @Param('id') id: string) {
    return this.service.markRead(req.user?.userId, id);
  }

  @Put('read-all')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllRead(@Req() req: any) {
    return this.service.markAllRead(req.user?.userId);
  }

  @Get('health')
  @ApiOperation({ summary: 'Notification system health snapshot' })
  async health() {
    const snapshot = this.service.getHealthSnapshot();
    const now = new Date();
    return { status: true, data: { ...snapshot, now } };
  }
}
