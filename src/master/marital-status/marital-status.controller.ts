import {
  Controller,
  Get,
  Param,
  UseGuards,
  Post,
  Body,
  Put,
  Delete,
  Req,
} from '@nestjs/common';
import { MaritalStatusService } from './marital-status.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import {
  UpdateMaritalStatusDto,
  BulkUpdateMaritalStatusDto,
} from './dto/marital-status.dto';

@ApiTags('Marital Status')
@Controller('api')
export class MaritalStatusController {
  constructor(private service: MaritalStatusService) {}

  @Get('marital-statuses')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.marital-status.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all marital statuses' })
  async list() {
    return this.service.list();
  }

  @Get('marital-statuses/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.marital-status.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get marital status by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Put('marital-statuses/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.marital-status.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update marital status' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'Married' },
        status: { type: 'string', example: 'active' },
      },
    },
  })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateMaritalStatusDto,
    @Req() req,
  ) {
    return this.service.update(id, updateDto, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('marital-statuses/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.marital-status.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete marital status' })
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('marital-statuses/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.marital-status.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk create marital statuses' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        names: {
          type: 'array',
          items: { type: 'string' },
          example: ['Single', 'Married'],
        },
      },
    },
  })
  async bulkCreate(@Body() body: { names: string[] }, @Req() req) {
    if (!body || !Array.isArray(body.names)) {
      return {
        status: false,
        message: 'Invalid payload, expected object with names array',
      };
    }
    return this.service.bulkCreate(body.names, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('marital-statuses/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.marital-status.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update marital statuses in bulk' })
  @ApiBody({ type: BulkUpdateMaritalStatusDto })
  async updateBulk(@Body() body: BulkUpdateMaritalStatusDto, @Req() req) {
    return this.service.updateBulk(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('marital-statuses/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.marital-status.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete marital statuses in bulk' })
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
