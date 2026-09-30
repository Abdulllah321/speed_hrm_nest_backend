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
import { ItemSubclassService } from './item-subclass.service';
import {
  CreateItemSubclassesDto,
  UpdateItemSubclassDto,
  BulkUpdateItemSubclassesDto,
} from './dto/item-subclass.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { Permissions } from '../../../common/decorators/permissions.decorator';

@Controller('api/master/erp/item-subclass')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ItemSubclassController {
  constructor(private readonly itemSubclassService: ItemSubclassService) {}

  @Get()
  @Permissions('master.item-subclass.read')
  async getAll() {
    return this.itemSubclassService.getAll();
  }

  @Get(':id')
  @Permissions('master.item-subclass.read')
  async getById(@Param('id') id: string) {
    return this.itemSubclassService.getById(id);
  }

  @Get('class/:itemClassId')
  @Permissions('master.item-subclass.read')
  async getByClass(@Param('itemClassId') itemClassId: string) {
    return this.itemSubclassService.getByClass(itemClassId);
  }

  @Post()
  @Permissions('master.item-subclass.create')
  async createMany(@Body() dto: CreateItemSubclassesDto, @Req() req: any) {
    return this.itemSubclassService.createMany(
      dto.items,
      req.user.id || req.user.userId,
    );
  }

  @Put('bulk')
  @Permissions('master.item-subclass.update')
  async updateMany(@Body() dto: BulkUpdateItemSubclassesDto, @Req() req: any) {
    return this.itemSubclassService.updateMany(dto.items, {
      userId: req.user.id || req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put(':id')
  @Permissions('master.item-subclass.update')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateItemSubclassDto,
    @Req() req: any,
  ) {
    return this.itemSubclassService.update(id, dto, {
      userId: req.user.id || req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('bulk')
  @Permissions('master.item-subclass.delete')
  async deleteMany(@Body('ids') ids: string[], @Req() req: any) {
    return this.itemSubclassService.deleteMany(ids, {
      userId: req.user.id || req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @Permissions('master.item-subclass.delete')
  async delete(@Param('id') id: string, @Req() req: any) {
    return this.itemSubclassService.delete(id, {
      userId: req.user.id || req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
