import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { SegmentService } from './segment.service';
import {
  CreateSegmentsDto,
  UpdateSegmentDto,
  BulkUpdateSegmentsDto,
} from './dto/segment.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { Permissions } from '../../../common/decorators/permissions.decorator';

@Controller('api/master/erp/segment')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SegmentController {
  constructor(private readonly segmentService: SegmentService) {}

  @Get()
  @Permissions('master.segment.read')
  async getAll() {
    return this.segmentService.getAll();
  }

  @Get(':id')
  @Permissions('master.segment.read')
  async getById(@Param('id') id: string) {
    return this.segmentService.getById(id);
  }

  @Post()
  @Permissions('master.segment.create')
  async createMany(@Body() dto: CreateSegmentsDto, @Req() req: any) {
    return this.segmentService.createMany(
      dto.items,
      req.user.id || req.user.userId,
    );
  }

  @Put('bulk')
  @Permissions('master.segment.update')
  async updateMany(@Body() dto: BulkUpdateSegmentsDto, @Req() req: any) {
    return this.segmentService.updateMany(dto.items, {
      userId: req.user.id || req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put(':id')
  @Permissions('master.segment.update')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSegmentDto,
    @Req() req: any,
  ) {
    return this.segmentService.update(id, dto, {
      userId: req.user.id || req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('bulk')
  @Permissions('master.segment.delete')
  async deleteMany(@Body('ids') ids: string[], @Req() req: any) {
    return this.segmentService.deleteMany(ids, {
      userId: req.user.id || req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @Permissions('master.segment.delete')
  async delete(@Param('id') id: string, @Req() req: any) {
    return this.segmentService.delete(id, {
      userId: req.user.id || req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
