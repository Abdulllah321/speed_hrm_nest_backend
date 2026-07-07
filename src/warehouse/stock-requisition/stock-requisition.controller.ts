import { Controller, Post, Get, Patch, Body, Param, Query, UseGuards, Req, BadRequestException } from '@nestjs/common';
import { StockRequisitionService } from './stock-requisition.service';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Stock Requisition Note (SRN)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api/stock-requisition')
export class StockRequisitionController {
  constructor(private readonly requisitionService: StockRequisitionService) {}

  @Post()
  @Permissions('erp.inventory.transfer.create')
  @ApiOperation({ summary: 'Create a new stock requisition note (SRN)' })
  async create(
    @Body() dto: {
      fromWarehouseId: string;
      toLocationId: string;
      brandId?: string;
      documentType?: string;
      remarks?: string;
      notes?: string;
      financialYear?: string;
      items: { itemId: string; quantity: number }[];
    },
    @Req() req: any,
  ) {
    const data = await this.requisitionService.createRequisition(dto, req.user?.id);
    return { status: true, data, message: 'Stock Requisition Note created and stock reserved successfully' };
  }

  @Post('upload')
  @Permissions('erp.inventory.transfer.create')
  @ApiOperation({ summary: 'Upload consolidated Excel sheet to parse items' })
  async uploadExcel(@Req() req: any) {
    const file = await req.file();
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const allowedExtensions = ['xlsx', 'xls', 'csv'];
    const ext = file.filename.split('.').pop()?.toLowerCase();
    if (!ext || !allowedExtensions.includes(ext)) {
      throw new BadRequestException(`Invalid file type. Allowed: ${allowedExtensions.join(', ')}`);
    }

    const buffer = await file.toBuffer();
    const data = await this.requisitionService.parseExcelSheet(buffer);
    return { status: true, data, message: 'Excel sheet parsed successfully' };
  }

  @Get('replenishment-candidates')
  @Permissions('erp.inventory.stock-transfer.read')
  @ApiOperation({ summary: 'Get replenishment candidates based on POS net sales summary and warehouse availability' })
  async getReplenishmentCandidates(
    @Query('locationId') locationId: string,
    @Query('fromWarehouseId') fromWarehouseId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const data = await this.requisitionService.getReplenishmentCandidates({
      locationId,
      fromWarehouseId,
      startDate,
      endDate,
    });
    return { status: true, data };
  }

  @Get()
  @Permissions('erp.inventory.stock-transfer.read')
  @ApiOperation({ summary: 'Get all stock requisitions' })
  async getRequisitions(
    @Query('warehouseId') warehouseId?: string,
    @Query('locationId') locationId?: string,
    @Query('brandId') brandId?: string,
    @Query('status') status?: string,
  ) {
    const data = await this.requisitionService.getRequisitions({
      warehouseId,
      locationId,
      brandId,
      status,
    });
    return { status: true, data };
  }

  @Get(':id')
  @Permissions('erp.inventory.stock-transfer.read')
  @ApiOperation({ summary: 'Get stock requisition by ID' })
  async getRequisitionById(@Param('id') id: string) {
    const data = await this.requisitionService.getRequisitionById(id);
    return { status: true, data };
  }

  @Patch(':id')
  @Permissions('erp.inventory.transfer.create')
  @ApiOperation({ summary: 'Update a draft stock requisition' })
  async update(
    @Param('id') id: string,
    @Body() dto: {
      fromWarehouseId?: string;
      toLocationId?: string;
      brandId?: string;
      documentType?: string;
      remarks?: string;
      notes?: string;
      financialYear?: string;
      items?: { itemId: string; quantity: number }[];
    },
    @Req() req: any,
  ) {
    const data = await this.requisitionService.updateRequisition(id, dto, req.user?.id);
    return { status: true, data, message: 'Stock Requisition updated successfully' };
  }

  @Post(':id/approve')
  @Permissions('erp.inventory.transfer.create')
  @ApiOperation({ summary: 'Approve a draft stock requisition' })
  async approve(@Param('id') id: string, @Req() req: any) {
    const data = await this.requisitionService.approveRequisition(id, req.user?.id);
    return { status: true, data, message: 'Stock Requisition approved and stock reserved successfully' };
  }

  @Post(':id/cancel')
  @Permissions('erp.inventory.transfer.create')
  @ApiOperation({ summary: 'Cancel stock requisition note and release stock' })
  async cancel(@Param('id') id: string, @Req() req: any) {
    const data = await this.requisitionService.cancelRequisition(id, req.user?.id);
    return { status: true, data, message: 'Requisition cancelled successfully' };
  }

  @Post(':id/convert-stn')
  @Permissions('erp.inventory.transfer.create')
  @ApiOperation({ summary: 'Convert stock requisition note to stock transfer out (STN)' })
  async convertToSTN(
    @Param('id') id: string,
    @Body() dto: {
      items: { itemId: string; quantity: number }[];
      notes?: string;
    },
    @Req() req: any,
  ) {
    const data = await this.requisitionService.convertToSTN(id, dto, req.user?.id);
    return { status: true, data, message: 'Requisition converted to Transfer Request successfully' };
  }
}
