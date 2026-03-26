import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PurchaseReturnService } from './purchase-return.service';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto';
import { UpdatePurchaseReturnDto } from './dto/update-purchase-return.dto';

@ApiTags('purchase-returns')
@Controller('api/purchase/purchase-returns')
export class PurchaseReturnController {
  constructor(private readonly purchaseReturnService: PurchaseReturnService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new purchase return' })
  @ApiResponse({ status: 201, description: 'Purchase return created successfully' })
  create(@Body() createDto: CreatePurchaseReturnDto) {
    return this.purchaseReturnService.create(createDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all purchase returns' })
  @ApiResponse({ status: 200, description: 'List of purchase returns' })
  findAll(@Query('status') status?: string) {
    return this.purchaseReturnService.findAll(status);
  }

  @Get('eligible-grns')
  @ApiOperation({ summary: 'Get eligible GRNs for return' })
  @ApiResponse({ status: 200, description: 'List of eligible GRNs' })
  getEligibleGrns() {
    return this.purchaseReturnService.getEligibleGrns();
  }

  @Get('eligible-landed-costs')
  @ApiOperation({ summary: 'Get eligible landed costs for return' })
  @ApiResponse({ status: 200, description: 'List of eligible landed costs' })
  getEligibleLandedCosts() {
    return this.purchaseReturnService.getEligibleLandedCosts();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get purchase return by ID' })
  @ApiResponse({ status: 200, description: 'Purchase return details' })
  @ApiResponse({ status: 404, description: 'Purchase return not found' })
  findOne(@Param('id') id: string) {
    return this.purchaseReturnService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update purchase return' })
  @ApiResponse({ status: 200, description: 'Purchase return updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - validation failed' })
  update(@Param('id') id: string, @Body() updateDto: UpdatePurchaseReturnDto) {
    return this.purchaseReturnService.update(id, updateDto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update purchase return status' })
  @ApiResponse({ status: 200, description: 'Status updated successfully' })
  updateStatus(
    @Param('id') id: string, 
    @Body() body: { status: string; approvedBy?: string }
  ) {
    return this.purchaseReturnService.updateStatus(id, body.status, body.approvedBy);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete purchase return' })
  @ApiResponse({ status: 200, description: 'Purchase return deleted successfully' })
  @ApiResponse({ status: 400, description: 'Cannot delete non-draft return' })
  remove(@Param('id') id: string) {
    return this.purchaseReturnService.remove(id);
  }
}