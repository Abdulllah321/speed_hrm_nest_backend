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
import { SilhouetteService } from './silhouette.service';
import {
  CreateSilhouetteDto,
  UpdateSilhouetteDto,
  BulkUpdateSilhouetteItemDto,
} from './dto/silhouette.dto';

@ApiTags('Silhouette')
@ApiBearerAuth()
@Controller('api')
export class SilhouetteController {
  constructor(private readonly silhouetteService: SilhouetteService) {}

  @Get('silhouettes')
  @ApiOperation({ summary: 'Get all silhouettes' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.silhouette.read'))
  async getAllSilhouettes() {
    return this.silhouetteService.getAllSilhouettes();
  }

  @Get('silhouettes/:id')
  @ApiOperation({ summary: 'Get silhouette by ID' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.silhouette.read'))
  async getSilhouetteById(@Param('id') id: string) {
    return this.silhouetteService.getSilhouetteById(id);
  }

  @Post('silhouettes')
  @ApiOperation({ summary: 'Create silhouettes (bulk)' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.silhouette.create'))
  async createSilhouettes(
    @Body() body: { items: CreateSilhouetteDto[] },
    @Req() req: any,
  ) {
    return this.silhouetteService.createSilhouettes(
      body.items,
      req.user.userId,
    );
  }

  @Put('silhouettes/:id')
  @ApiOperation({ summary: 'Update silhouette' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.silhouette.update'))
  async updateSilhouette(
    @Param('id') id: string,
    @Body() dto: UpdateSilhouetteDto,
    @Req() req: any,
  ) {
    return this.silhouetteService.updateSilhouette(id, dto, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('silhouettes/bulk/update')
  @ApiOperation({ summary: 'Bulk update silhouettes' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.silhouette.update'))
  async updateSilhouettes(
    @Body() body: { items: BulkUpdateSilhouetteItemDto[] },
    @Req() req: any,
  ) {
    return this.silhouetteService.updateSilhouettes(body.items, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('silhouettes/bulk/delete')
  @ApiOperation({ summary: 'Bulk delete silhouettes' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.silhouette.delete'))
  async deleteSilhouettes(@Body() body: { ids: string[] }, @Req() req: any) {
    return this.silhouetteService.deleteSilhouettes(body.ids, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('silhouettes/:id')
  @ApiOperation({ summary: 'Delete silhouette' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.silhouette.delete'))
  async deleteSilhouette(@Param('id') id: string, @Req() req: any) {
    return this.silhouetteService.deleteSilhouette(id, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
