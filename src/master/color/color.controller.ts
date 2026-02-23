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
import { ColorService } from './color.service';
import {
  CreateColorDto,
  UpdateColorDto,
  BulkUpdateColorItemDto,
} from './dto/color.dto';

@ApiTags('Color')
@ApiBearerAuth()
@Controller('api')
export class ColorController {
  constructor(private readonly colorService: ColorService) {}

  @Get('colors')
  @ApiOperation({ summary: 'Get all colors' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.color.read'))
  async getAllColors() {
    return this.colorService.getAllColors();
  }

  @Get('colors/:id')
  @ApiOperation({ summary: 'Get color by ID' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.color.read'))
  async getColorById(@Param('id') id: string) {
    return this.colorService.getColorById(id);
  }

  @Post('colors')
  @ApiOperation({ summary: 'Create colors (bulk)' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.color.create'))
  async createColors(
    @Body() body: { items: CreateColorDto[] },
    @Req() req: any,
  ) {
    return this.colorService.createColors(body.items, req.user.userId);
  }

  @Put('colors/:id')
  @ApiOperation({ summary: 'Update color' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.color.update'))
  async updateColor(
    @Param('id') id: string,
    @Body() dto: UpdateColorDto,
    @Req() req: any,
  ) {
    return this.colorService.updateColor(id, dto, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('colors/bulk/update')
  @ApiOperation({ summary: 'Bulk update colors' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.color.update'))
  async updateColors(
    @Body() body: { items: BulkUpdateColorItemDto[] },
    @Req() req: any,
  ) {
    return this.colorService.updateColors(body.items, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('colors/bulk/delete')
  @ApiOperation({ summary: 'Bulk delete colors' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.color.delete'))
  async deleteColors(@Body() body: { ids: string[] }, @Req() req: any) {
    return this.colorService.deleteColors(body.ids, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('colors/:id')
  @ApiOperation({ summary: 'Delete color' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.color.delete'))
  async deleteColor(@Param('id') id: string, @Req() req: any) {
    return this.colorService.deleteColor(id, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
