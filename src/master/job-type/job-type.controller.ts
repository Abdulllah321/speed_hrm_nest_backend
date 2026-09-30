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
import { JobTypeService } from './job-type.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';

@ApiTags('Job Type')
@Controller('api')
export class JobTypeController {
  constructor(private service: JobTypeService) {}

  @Get('job-types')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.job-type.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all job types' })
  async list() {
    return this.service.list();
  }

  @Get('job-types/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.job-type.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get job type by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('job-types')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.job-type.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create job type' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { name: { type: 'string', example: 'Full Time' } },
    },
  })
  async create(@Body() body: { name: string }, @Req() req) {
    return this.service.create(body.name, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('job-types/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.job-type.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create job types in bulk' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        names: {
          type: 'array',
          items: { type: 'string' },
          example: ['Full Time', 'Part Time'],
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

  @Put('job-types/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.job-type.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update job type' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { name: { type: 'string', example: 'Internship' } },
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

  @Put('job-types/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.job-type.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update job types in bulk' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, name: { type: 'string' } },
            example: [{ id: 'uuid', name: 'Contract' }],
          },
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

  @Delete('job-types/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.job-type.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete job type' })
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('job-types/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.job-type.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete job types in bulk' })
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
