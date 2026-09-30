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
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { SizeService } from './size.service';
import {
  CreateSizeDto,
  UpdateSizeDto,
  BulkUpdateSizeItemDto,
} from './dto/size.dto';

@ApiTags('Size')
@ApiBearerAuth()
@Controller('api')
export class SizeController {
  constructor(private readonly sizeService: SizeService) {}

  @Get('sizes')
  @ApiOperation({ summary: 'Get all sizes' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.size.read'))
  async getAllSizes() {
    return this.sizeService.getAllSizes();
  }

  @Get('sizes/:id')
  @ApiOperation({ summary: 'Get size by ID' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.size.read'))
  async getSizeById(@Param('id') id: string) {
    return this.sizeService.getSizeById(id);
  }

  @Post('sizes')
  @ApiOperation({ summary: 'Create sizes (bulk)' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.size.create'))
  async createSizes(@Body() body: { items: CreateSizeDto[] }, @Req() req: any) {
    return this.sizeService.createSizes(body.items, req.user.userId);
  }

  @Put('sizes/:id')
  @ApiOperation({ summary: 'Update size' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.size.update'))
  async updateSize(
    @Param('id') id: string,
    @Body() dto: UpdateSizeDto,
    @Req() req: any,
  ) {
    return this.sizeService.updateSize(id, dto, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('sizes/bulk/update')
  @ApiOperation({ summary: 'Bulk update sizes' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.size.update'))
  async updateSizes(
    @Body() body: { items: BulkUpdateSizeItemDto[] },
    @Req() req: any,
  ) {
    return this.sizeService.updateSizes(body.items, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('sizes/bulk/delete')
  @ApiOperation({ summary: 'Bulk delete sizes' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.size.delete'))
  async deleteSizes(@Body() body: { ids: string[] }, @Req() req: any) {
    return this.sizeService.deleteSizes(body.ids, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('sizes/:id')
  @ApiOperation({ summary: 'Delete size' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.size.delete'))
  async deleteSize(@Param('id') id: string, @Req() req: any) {
    return this.sizeService.deleteSize(id, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
