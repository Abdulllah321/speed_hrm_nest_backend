import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
  Req,
} from '@nestjs/common';
import { UnitOfMeasurementService } from './unit-of-measurement.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  UpdateUnitOfMeasurementDto,
  BulkUpdateUnitOfMeasurementDto,
  CreateUnitOfMeasurementDto,
} from './dto/unit-of-measurement.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';

@ApiTags('Unit of Measurement')
@Controller('api')
export class UnitOfMeasurementController {
  constructor(private service: UnitOfMeasurementService) {}

  @Get('units-of-measurement')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all units of measurement' })
  async list() {
    return this.service.getAll();
  }

  @Get('units-of-measurement/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get unit of measurement by id' })
  async get(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post('units-of-measurement')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create units of measurement in bulk' })
  @ApiBody({ type: [CreateUnitOfMeasurementDto] })
  async createBulk(@Body() body: { items: CreateUnitOfMeasurementDto[] }, @Req() req) {
    return this.service.createBulk(body.items || [], req.user.userId);
  }

  @Put('units-of-measurement/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update units of measurement in bulk' })
  @ApiBody({ type: BulkUpdateUnitOfMeasurementDto })
  async updateBulk(@Body() body: BulkUpdateUnitOfMeasurementDto, @Req() req) {
    return this.service.updateBulk(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('units-of-measurement/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update unit of measurement' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUnitOfMeasurementDto,
    @Req() req,
  ) {
    return this.service.update(id, dto, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('units-of-measurement/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete units of measurement in bulk' })
  async deleteBulk(@Body() body: { ids: string[] }, @Req() req) {
    return this.service.deleteBulk(body.ids || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('units-of-measurement/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete unit of measurement' })
  async delete(@Param('id') id: string, @Req() req) {
    return this.service.delete(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
