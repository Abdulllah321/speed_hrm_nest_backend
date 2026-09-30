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
import { AllocationService } from './allocation.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';

@ApiTags('Allocation')
@Controller('api')
export class AllocationController {
  constructor(private service: AllocationService) {}

  @Get('allocations')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.allocation.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all allocations' })
  async list() {
    return this.service.list();
  }

  @Get('allocations/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.allocation.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get allocation by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('allocations')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.allocation.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create allocation' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { name: { type: 'string', example: 'Allocation 1' } },
    },
  })
  async create(@Body() body: { name: string }, @Req() req) {
    return this.service.create(body.name, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('allocations/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.allocation.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create allocations in bulk' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        names: {
          type: 'array',
          items: { type: 'string' },
          example: ['Allocation 1', 'Allocation 2'],
        },
      },
    },
  })
  async createBulk(@Body() body: { names: string[] }, @Req() req) {
    return this.service.createBulk(body.names || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('allocations/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.allocation.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update allocation' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { name: { type: 'string', example: 'New Name' } },
    },
  })
  async update(
    @Param('id') id: string,
    @Body() body: { name: string },
    @Req() req,
  ) {
    return this.service.update(id, body.name, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('allocations/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.allocation.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update allocations in bulk' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, name: { type: 'string' } },
          },
          example: [{ id: 'uuid', name: 'New Name' }],
        },
      },
    },
  })
  async updateBulk(
    @Body() body: { items: { id: string; name: string }[] },
    @Req() req,
  ) {
    return this.service.updateBulk(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('allocations/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.allocation.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete allocation' })
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('allocations/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.allocation.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete allocations in bulk' })
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
