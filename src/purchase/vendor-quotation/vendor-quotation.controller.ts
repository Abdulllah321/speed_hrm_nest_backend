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
} from '@nestjs/common';
import { VendorQuotationService } from './vendor-quotation.service';
import { CreateVendorQuotationDto } from './dto/create-vendor-quotation.dto';
import { UpdateVendorQuotationDto } from './dto/update-vendor-quotation.dto';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Vendor Quotation')
@Controller('api/vendor-quotation')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VendorQuotationController {
  constructor(private readonly service: VendorQuotationService) {}

  @Post()
  @Permissions('erp.procurement.vq.create')
  @ApiOperation({ summary: 'Create vendor quotation for RFQ' })
  create(@Body() createDto: CreateVendorQuotationDto) {
    return this.service.create(createDto);
  }

  @Get()
  @Permissions('erp.procurement.vq.read')
  @ApiOperation({ summary: 'List all vendor quotations' })
  @ApiQuery({ name: 'rfqId', required: false, description: 'Filter by RFQ ID' })
  findAll(@Query('rfqId') rfqId?: string) {
    return this.service.findAll(rfqId);
  }

  @Get('compare/:rfqId')
  @Permissions('erp.procurement.vq.compare')
  @ApiOperation({ summary: 'Compare all submitted quotations for an RFQ' })
  compareQuotations(@Param('rfqId') rfqId: string) {
    return this.service.compareQuotations(rfqId);
  }

  @Get(':id')
  @Permissions('erp.procurement.vq.read')
  @ApiOperation({ summary: 'Get vendor quotation details' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post(':id/submit')
  @Permissions('erp.procurement.vq.submit')
  @ApiOperation({ summary: 'Submit quotation' })
  submitQuotation(@Param('id') id: string) {
    return this.service.submitQuotation(id);
  }

  @Post(':id/select')
  @Permissions('erp.procurement.vq.select')
  @ApiOperation({ summary: 'Select quotation (rejects others)' })
  selectQuotation(@Param('id') id: string) {
    return this.service.selectQuotation(id);
  }

  @Patch(':id')
  @Permissions('erp.procurement.vq.update')
  @ApiOperation({ summary: 'Update vendor quotation' })
  update(@Param('id') id: string, @Body() updateDto: UpdateVendorQuotationDto) {
    return this.service.update(id, updateDto);
  }

  @Delete(':id')
  @Permissions('erp.procurement.vq.delete')
  @ApiOperation({ summary: 'Delete DRAFT vendor quotation' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
