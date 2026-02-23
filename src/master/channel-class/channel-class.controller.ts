import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ChannelClassService } from './channel-class.service';
import {
  CreateChannelClassDto,
  UpdateChannelClassDto,
  BulkUpdateChannelClassItemDto,
} from './dto/channel-class.dto';

@ApiTags('Channel Class')
@ApiBearerAuth()
@Controller('api')
export class ChannelClassController {
  constructor(private readonly channelClassService: ChannelClassService) {}

  @Get('channel-classes')
  @ApiOperation({ summary: 'Get all channel classes' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.channel-class.read'))
  async getAllChannelClasses() {
    return this.channelClassService.getAllChannelClasses();
  }

  @Get('channel-classes/:id')
  @ApiOperation({ summary: 'Get channel class by ID' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.channel-class.read'))
  async getChannelClassById(@Param('id') id: string) {
    return this.channelClassService.getChannelClassById(id);
  }

  @Post('channel-classes')
  @ApiOperation({ summary: 'Create channel classes (bulk)' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.channel-class.create'))
  async createChannelClasses(
    @Body() body: { items: CreateChannelClassDto[] },
    @Req() req: any,
  ) {
    return this.channelClassService.createChannelClasses(
      body.items,
      req.user.userId,
    );
  }

  @Put('channel-classes/:id')
  @ApiOperation({ summary: 'Update channel class' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.channel-class.update'))
  async updateChannelClass(
    @Param('id') id: string,
    @Body() dto: UpdateChannelClassDto,
    @Req() req: any,
  ) {
    return this.channelClassService.updateChannelClass(id, dto, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('channel-classes/bulk/update')
  @ApiOperation({ summary: 'Bulk update channel classes' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.channel-class.update'))
  async updateChannelClasses(
    @Body() body: { items: BulkUpdateChannelClassItemDto[] },
    @Req() req: any,
  ) {
    return this.channelClassService.updateChannelClasses(body.items, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('channel-classes/bulk/delete')
  @ApiOperation({ summary: 'Bulk delete channel classes' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.channel-class.delete'))
  async deleteChannelClasses(@Body() body: { ids: string[] }, @Req() req: any) {
    return this.channelClassService.deleteChannelClasses(body.ids, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('channel-classes/:id')
  @ApiOperation({ summary: 'Delete channel class' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.channel-class.delete'))
  async deleteChannelClass(@Param('id') id: string, @Req() req: any) {
    return this.channelClassService.deleteChannelClass(id, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
