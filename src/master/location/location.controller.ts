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
import { LocationService } from './location.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { CreateLocationDto, UpdateLocationDto } from './dto/location.dto';

@ApiTags('Location')
@Controller('api')
export class LocationController {
  constructor(private service: LocationService) {}

  @Get('locations')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.location.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all locations' })
  async list() {
    return this.service.list();
  }

  @Get('locations/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.location.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get location by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('locations')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.location.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create location' })
  async create(@Body() body: CreateLocationDto, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('locations/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.location.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update location' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateLocationDto,
    @Req() req,
  ) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('locations/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.location.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete location' })
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('locations/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.location.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create locations in bulk' })
  @ApiBody({ type: CreateLocationDto, isArray: true })
  async createBulk(
    @Body()
    body: { items: CreateLocationDto[] },
    @Req() req,
  ) {
    return this.service.createBulk(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('locations/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.location.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update locations in bulk' })
  @ApiBody({ type: UpdateLocationDto, isArray: true })
  async updateBulk(
    @Body()
    body: { items: UpdateLocationDto[] },
    @Req() req,
  ) {
    return this.service.updateBulk(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('locations/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.location.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete locations in bulk' })
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
