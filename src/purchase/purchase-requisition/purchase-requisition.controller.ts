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
import { PurchaseRequisitionService } from './purchase-requisition.service';
import { CreatePurchaseRequisitionDto } from './dto/create-purchase-requisition.dto';
import { UpdatePurchaseRequisitionDto } from './dto/update-purchase-requisition.dto';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Purchase Requisition')
@Controller('api/purchase-requisition')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchaseRequisitionController {
  constructor(private readonly service: PurchaseRequisitionService) {}

  @Post()
  @Permissions('erp.procurement.pr.create')
  @ApiOperation({ summary: 'Create a new purchase requisition (DRAFT)' })
  create(@Body() createDto: CreatePurchaseRequisitionDto) {
    return this.service.create(createDto);
  }

  @Get()
  @Permissions('erp.procurement.pr.read')
  @ApiOperation({ summary: 'List all purchase requisitions' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status' })
  findAll(@Query('status') status?: string) {
    return this.service.findAll(status);
  }

  @Get(':id')
  @Permissions('erp.procurement.pr.read')
  @ApiOperation({ summary: 'Get a specific purchase requisition' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Permissions('erp.procurement.pr.update')
  @ApiOperation({ summary: 'Update a purchase requisition or change status' })
  update(
    @Param('id') id: string,
    @Body() updateDto: UpdatePurchaseRequisitionDto,
  ) {
    return this.service.update(id, updateDto);
  }

  @Delete(':id')
  @Permissions('erp.procurement.pr.delete')
  @ApiOperation({ summary: 'Delete a DRAFT purchase requisition' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
