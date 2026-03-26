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
import { QualificationService } from './qualification.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';

@ApiTags('Qualification')
@Controller('api')
export class QualificationController {
  constructor(private service: QualificationService) {}

  @Get('qualifications')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.qualification.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all qualifications' })
  async list() {
    return this.service.list();
  }

  @Get('qualifications/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.qualification.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get qualification by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('qualifications')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.qualification.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create qualification' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'Bachelors' },
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

  @Post('qualifications/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.qualification.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create qualifications in bulk' })
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
            example: [{ name: 'Bachelors' }],
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

  @Put('qualifications/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.qualification.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update qualification' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'Masters' },
        status: { type: 'string', example: 'active' },
      },
    },
  })
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; status?: string },
    @Req() req,
  ) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('qualifications/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.qualification.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete qualification' })
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('qualifications/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.qualification.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete qualifications in bulk' })
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
