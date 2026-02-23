import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BonusTypeService } from './bonus-type.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { CreateBonusTypeDto, UpdateBonusTypeDto } from './dto/bonus-type.dto';

interface AuthenticatedRequest {
  user?: { userId?: string };
  ip?: string;
  headers?: { 'user-agent'?: string };
}

@ApiTags('Bonus Type')
@Controller('api')
export class BonusTypeController {
  constructor(private service: BonusTypeService) {}

  @Get('bonus-types')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.bonus-type.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all bonus types' })
  async list() {
    return this.service.list();
  }

  @Get('bonus-types/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.bonus-type.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get bonus type by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('bonus-types')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.bonus-type.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create bonus type' })
  async create(
    @Body() body: CreateBonusTypeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Post('bonus-types/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.bonus-type.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create bonus types in bulk' })
  @ApiBody({ type: CreateBonusTypeDto, isArray: true })
  async createBulk(
    @Body() body: { items: CreateBonusTypeDto[] },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.createBulk(body.items ?? [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Put('bonus-types/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.bonus-type.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update bonus type' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateBonusTypeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Delete('bonus-types/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.bonus-type.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete bonus type' })
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Put('bonus-types/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.bonus-type.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update bonus types in bulk' })
  @ApiBody({ type: UpdateBonusTypeDto, isArray: true })
  async updateBulk(
    @Body() body: { items: UpdateBonusTypeDto[] },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.updateBulk((body.items as any) ?? [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Delete('bonus-types/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.bonus-type.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete bonus types in bulk' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          example: ['uuid1', 'uuid2'],
        },
      },
    },
  })
  async removeBulk(
    @Body() body: { ids: string[] },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.removeBulk(body.ids ?? [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }
}
