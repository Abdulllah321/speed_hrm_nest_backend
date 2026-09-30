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
import { OldSeasonService } from './old-season.service';
import {
  CreateOldSeasonsDto,
  UpdateOldSeasonDto,
  BulkUpdateOldSeasonsDto,
} from './dto/old-season.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { Permissions } from '../../../common/decorators/permissions.decorator';

@Controller('api/master/erp/old-season')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OldSeasonController {
  constructor(private readonly oldSeasonService: OldSeasonService) {}

  @Get()
  @Permissions('master.old-season.read')
  async getAll() {
    return this.oldSeasonService.getAll();
  }

  @Get(':id')
  @Permissions('master.old-season.read')
  async getById(@Param('id') id: string) {
    return this.oldSeasonService.getById(id);
  }

  @Post()
  @Permissions('master.old-season.create')
  async createMany(@Body() dto: CreateOldSeasonsDto, @Req() req: any) {
    return this.oldSeasonService.createMany(
      dto.items,
      req.user.id || req.user.userId,
    );
  }

  @Put('bulk')
  @Permissions('master.old-season.update')
  async updateMany(@Body() dto: BulkUpdateOldSeasonsDto, @Req() req: any) {
    return this.oldSeasonService.updateMany(dto.items, {
      userId: req.user.id || req.user.userId,
      ipAddress: req?.ip,
      userAgent: req?.headers['user-agent'],
    });
  }

  @Put(':id')
  @Permissions('master.old-season.update')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOldSeasonDto,
    @Req() req: any,
  ) {
    return this.oldSeasonService.update(id, dto, {
      userId: req.user.id || req.user.userId,
      ipAddress: req?.ip,
      userAgent: req?.headers['user-agent'],
    });
  }

  @Delete('bulk')
  @Permissions('master.old-season.delete')
  async deleteMany(@Body('ids') ids: string[], @Req() req: any) {
    return this.oldSeasonService.deleteMany(ids, {
      userId: req.user.id || req.user.userId,
      ipAddress: req?.ip,
      userAgent: req?.headers['user-agent'],
    });
  }

  @Delete(':id')
  @Permissions('master.old-season.delete')
  async delete(@Param('id') id: string, @Req() req: any) {
    return this.oldSeasonService.delete(id, {
      userId: req.user.id || req.user.userId,
      ipAddress: req?.ip,
      userAgent: req?.headers['user-agent'],
    });
  }
}
