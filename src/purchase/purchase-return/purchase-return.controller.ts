import { Controller, Get, Post, Body, Patch, Param, Delete, Query, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PurchaseReturnService } from './purchase-return.service';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto';
import { UpdatePurchaseReturnDto } from './dto/update-purchase-return.dto';

@ApiTags('purchase-returns')
@Controller('api/purchase/purchase-returns')
export class PurchaseReturnController {
  constructor(private readonly purchaseReturnService: PurchaseReturnService,) {}

  @Post()
  @ApiOperation({ summary: 'Create a new purchase return' })
  @ApiResponse({ status: 201, description: 'Purchase return created successfully' })
  create(@Body() createDto: CreatePurchaseReturnDto, @Req() req: any) {
    return this.purchaseReturnService.create(createDto, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
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
  update(@Param('id') id: string, @Body() updateDto: UpdatePurchaseReturnDto, @Req() req: any) {
    return this.purchaseReturnService.update(id, updateDto, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update purchase return status' })
  @ApiResponse({ status: 200, description: 'Status updated successfully' })
  updateStatus(
    @Param('id') id: string, 
    @Body() body: { status: string; approvedBy?: string },
    @Req() req: any
  ) {
    return this.purchaseReturnService.updateStatus(id, body.status, body.approvedBy, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete purchase return' })
  @ApiResponse({ status: 200, description: 'Purchase return deleted successfully' })
  @ApiResponse({ status: 400, description: 'Cannot delete non-draft return' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.purchaseReturnService.remove(id, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}