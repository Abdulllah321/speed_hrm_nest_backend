import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { RfqService } from './rfq.service';
import { CreateRfqDto } from './dto/create-rfq.dto';
import { UpdateRfqDto, AddVendorsDto } from './dto/update-rfq.dto';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Request For Quotation (RFQ)')
@Controller('api/rfq')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RfqController {
  constructor(private readonly service: RfqService,) {}

  @Post()
  @Permissions('erp.procurement.rfq.create')
  @ApiOperation({ summary: 'Create RFQ from APPROVED Purchase Requisition' })
  create(@Body() createDto: CreateRfqDto, @Req() req: any) {
    return this.service.create(createDto, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @Permissions('erp.procurement.rfq.read')
  @ApiOperation({ summary: 'List all RFQs' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status' })
  findAll(@Query('status') status?: string) {
    return this.service.findAll(status);
  }

  @Get(':id')
  @Permissions('erp.procurement.rfq.read')
  @ApiOperation({ summary: 'Get RFQ details with PR items and vendors' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post(':id/vendors')
  @Permissions('erp.procurement.rfq.add-vendors')
  @ApiOperation({ summary: 'Add vendors to DRAFT RFQ' })
  addVendors(@Param('id') id: string, @Body() addVendorsDto: AddVendorsDto, @Req() req: any) {
    return this.service.addVendors(id, addVendorsDto, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/send')
  @Permissions('erp.procurement.rfq.send')
  @ApiOperation({ summary: 'Mark RFQ as SENT' })
  markAsSent(@Param('id') id: string, @Req() req: any) {
    return this.service.markAsSent(id, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Patch(':id')
  @Permissions('erp.procurement.rfq.update')
  @ApiOperation({ summary: 'Update RFQ' })
  update(@Param('id') id: string, @Body() updateDto: UpdateRfqDto, @Req() req: any) {
    return this.service.update(id, updateDto, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @Permissions('erp.procurement.rfq.delete')
  @ApiOperation({ summary: 'Delete DRAFT RFQ' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
