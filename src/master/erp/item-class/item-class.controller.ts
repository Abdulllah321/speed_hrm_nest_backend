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
import { ItemClassService } from './item-class.service';
import {
  CreateItemClassesDto,
  UpdateItemClassDto,
  BulkUpdateItemClassesDto,
} from './dto/item-class.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { Permissions } from '../../../common/decorators/permissions.decorator';

@Controller('api/master/erp/item-class')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ItemClassController {
  constructor(private readonly itemClassService: ItemClassService) {}

  @Get()
  @Permissions('master.item-class.read')
  async getAll() {
    return this.itemClassService.getAll();
  }

  @Get(':id')
  @Permissions('master.item-class.read')
  async getById(@Param('id') id: string) {
    return this.itemClassService.getById(id);
  }

  @Post()
  @Permissions('master.item-class.create')
  async createMany(@Body() dto: CreateItemClassesDto, @Req() req: any) {
    return this.itemClassService.createMany(
      dto.items,
      req.user.id || req.user.userId,
    );
  }

  @Put('bulk')
  @Permissions('master.item-class.update')
  async updateMany(@Body() dto: BulkUpdateItemClassesDto, @Req() req: any) {
    return this.itemClassService.updateMany(dto.items, {
      userId: req.user.id || req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put(':id')
  @Permissions('master.item-class.update')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateItemClassDto,
    @Req() req: any,
  ) {
    return this.itemClassService.update(id, dto, {
      userId: req.user.id || req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('bulk')
  @Permissions('master.item-class.delete')
  async deleteMany(@Body('ids') ids: string[], @Req() req: any) {
    return this.itemClassService.deleteMany(ids, {
      userId: req.user.id || req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @Permissions('master.item-class.delete')
  async delete(@Param('id') id: string, @Req() req: any) {
    return this.itemClassService.delete(id, {
      userId: req.user.id || req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
