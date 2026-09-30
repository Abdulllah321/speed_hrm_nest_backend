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
import { SeasonService } from './season.service';
import {
  CreateSeasonsDto,
  UpdateSeasonDto,
  BulkUpdateSeasonsDto,
} from './dto/season.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';

@Controller('api/master/erp/season')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SeasonController {
  constructor(private readonly seasonService: SeasonService) {}

  @Get()
  @Permissions('erp.season.read')
  async getAll() {
    return this.seasonService.getAll();
  }

  @Get(':id')
  @Permissions('erp.season.read')
  async getById(@Param('id') id: string) {
    return this.seasonService.getById(id);
  }

  @Post()
  @Permissions('erp.season.create')
  async createMany(@Body() dto: CreateSeasonsDto, @Req() req: any) {
    return this.seasonService.createMany(
      dto.items,
      req.user.id || req.user.userId,
    );
  }

  @Put('bulk')
  @Permissions('erp.season.update')
  async updateMany(@Body() dto: BulkUpdateSeasonsDto, @Req() req: any) {
    return this.seasonService.updateMany(dto.items, {
      userId: req.user.id || req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put(':id')
  @Permissions('erp.season.update')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSeasonDto,
    @Req() req: any,
  ) {
    return this.seasonService.update(id, dto, {
      userId: req.user.id || req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('bulk')
  @Permissions('erp.season.delete')
  async deleteMany(@Body('ids') ids: string[], @Req() req: any) {
    return this.seasonService.deleteMany(ids, {
      userId: req.user.id || req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @Permissions('erp.season.delete')
  async delete(@Param('id') id: string, @Req() req: any) {
    return this.seasonService.delete(id, {
      userId: req.user.id || req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
