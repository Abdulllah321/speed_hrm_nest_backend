import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { StockAdjustmentService } from './stock-adjustment.service';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('api/stock-adjustments')
@UseGuards(JwtAuthGuard)
export class StockAdjustmentController {
  private readonly logger = new Logger(StockAdjustmentController.name);

  constructor(private readonly service: StockAdjustmentService) {}

  @Post()
  async create(@Body() dto: CreateStockAdjustmentDto, @Req() req: any) {
    this.logger.log(`Stock adjustment creation request received`);
    return this.service.create(dto, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  async findAll(
    @Query('warehouseId') warehouseId?: string,
    @Query('locationId') locationId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.service.findAll({
      warehouseId,
      locationId,
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: CreateStockAdjustmentDto,
    @Req() req: any,
  ) {
    this.logger.log(`Stock adjustment update request received for ID: ${id}`);
    return this.service.update(id, dto, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @Req() req: any) {
    this.logger.log(`Stock adjustment delete request received for ID: ${id}`);
    return this.service.delete(id, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/submit')
  async submit(
    @Param('id') id: string,
    @Body() dto: { items?: { itemId: string; physicalQty: number; rate?: number }[]; notes?: string },
    @Req() req: any,
  ) {
    this.logger.log(`Stock adjustment submit request received for ID: ${id}`);
    return this.service.submit(id, dto, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/reject')
  async reject(
    @Param('id') id: string,
    @Body() dto: { notes?: string },
    @Req() req: any,
  ) {
    this.logger.log(`Stock adjustment reject request received for ID: ${id}`);
    return this.service.reject(id, dto, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
