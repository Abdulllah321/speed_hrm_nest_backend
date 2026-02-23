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
import { DesignationService } from './designation.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';

@ApiTags('Designation')
@Controller('api')
export class DesignationController {
  constructor(private service: DesignationService) {}

  @Get('designations')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.designation.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all designations' })
  async list() {
    return this.service.list();
  }

  @Get('designations/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.designation.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get designation by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('designations')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.designation.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create designation' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { name: { type: 'string', example: 'Manager' } },
    },
  })
  async create(@Body() body: { name: string }, @Req() req) {
    return this.service.create(body.name, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('designations/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.designation.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create designations in bulk' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        names: {
          type: 'array',
          items: { type: 'string' },
          example: ['Manager', 'Developer'],
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

  @Put('designations/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.designation.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update designation' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { name: { type: 'string', example: 'Senior Manager' } },
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

  @Put('designations/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.designation.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update designations in bulk' })
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

  @Delete('designations/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.designation.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete designation' })
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('designations/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.designation.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete designations in bulk' })
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
