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
import { LeaveTypeService } from './leave-type.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';

@ApiTags('Leave Type')
@Controller('api')
export class LeaveTypeController {
  constructor(private service: LeaveTypeService) {}

  @Get('leave-types')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.leave-type.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all leave types' })
  async list() {
    return this.service.list();
  }

  @Get('leave-types/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.leave-type.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get leave type by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('leave-types')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.leave-type.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create leave type' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'Annual' },
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

  @Put('leave-types/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.leave-type.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update leave type' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'Sick' },
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

  @Delete('leave-types/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.leave-type.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete leave type' })
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('leave-types/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.leave-type.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create leave types in bulk' })
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
            example: [{ name: 'Annual' }],
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

  @Put('leave-types/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.leave-type.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update leave types in bulk' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              status: { type: 'string' },
            },
            example: [{ id: 'uuid', name: 'Sick' }],
          },
        },
      },
    },
  })
  async updateBulk(
    @Body() body: { items: { id: string; name: string; status?: string }[] },
    @Req() req,
  ) {
    return this.service.updateBulk(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('leave-types/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.leave-type.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete leave types in bulk' })
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
  async removeBulk(@Body() body: { ids: string[] }, @Req() req) {
    return this.service.removeBulk(body.ids || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
