import { Controller, Get, Post, Body, Param, Patch, UseGuards, Req, Logger } from '@nestjs/common';
import { GrnService } from './grn.service';
import { CreateGrnDto } from './dto/grn.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Goods Receipt Note')
@Controller('api/grn')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class GrnController {
  private readonly logger = new Logger(GrnController.name);

  constructor(private readonly grnService: GrnService,) {}

  @Post()
  @ApiOperation({ summary: 'Create a new GRN and update stock' })
  @Permissions('erp.procurement.grn.create')
  async create(@Body() createDto: CreateGrnDto, @Req() req: any) {
    this.logger.log(`GRN creation request received`);
    this.logger.debug(`Request payload: ${JSON.stringify(createDto)}`);
    
    try {
      const result = await this.grnService.create(createDto, {
        userId: req.user?.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      this.logger.log(`GRN creation successful: ${result.id}`);
      return result;
    } catch (error) {
      this.logger.error(`GRN creation failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get()
  @ApiOperation({ summary: 'Get all GRNs' })
  @Permissions('erp.procurement.grn.read')
  findAll() {
    return this.grnService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get GRN by ID' })
  @Permissions('erp.procurement.grn.read')
  findOne(@Param('id') id: string) {
    return this.grnService.findOne(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update GRN status' })
  @Permissions('erp.procurement.grn.update', 'erp.procurement.grn.check', 'erp.procurement.grn.authorize')
  updateStatus(@Param('id') id: string, @Body('status') status: string, @Req() req: any) {
    return this.grnService.updateStatus(id, status, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      permissions: req.user?.permissions || [],
      roleName: req.user?.roleName || '',
    });
  }
}
