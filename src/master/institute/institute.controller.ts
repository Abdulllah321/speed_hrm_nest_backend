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
import { InstituteService } from './institute.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';

@ApiTags('Institute')
@Controller('api')
export class InstituteController {
  constructor(private service: InstituteService) {}

  @Get('institutes')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.institute.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all institutes' })
  async list() {
    return this.service.list();
  }

  @Get('institutes/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.institute.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get institute by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('institutes')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.institute.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create institute' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'MIT' },
        status: { type: 'string', example: 'active' },
      },
    },
  })
  async create(@Body() body: { name: string; status?: string }, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('institutes/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.institute.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update institute' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'Stanford' },
        status: { type: 'string', example: 'active' },
      },
    },
  })
  async update(
    @Param('id') id: string,
    @Body() body: { name: string; status?: string },
    @Req() req,
  ) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('institutes/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.institute.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete institute' })
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('institutes/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.institute.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create institutes in bulk' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              status: { type: 'string' },
            },
            example: [{ name: 'MIT' }],
          },
        },
      },
    },
  })
  async createBulk(
    @Body() body: { items: { name: string; status?: string }[] },
    @Req() req,
  ) {
    return this.service.createBulk(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('institutes/seed')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.institute.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Seed institutes' })
  async seed(@Req() req) {
    return this.service.seed({
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
