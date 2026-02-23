import { Controller, Get, Post, Body, Query, Param } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('stock-level')
  @ApiOperation({
    summary: 'Get aggregated stock level for an item in a warehouse',
  })
  getStockLevel(
    @Query('itemId') itemId: string,
    @Query('warehouseId') warehouseId: string,
  ) {
    return this.inventoryService.getStockLevel(itemId, warehouseId);
  }

  @Get('details/:itemId')
  @ApiOperation({ summary: 'Get detailed stock breakdown by location/batch' })
  getDetailedStock(@Param('itemId') itemId: string) {
    return this.inventoryService.getDetailedStock(itemId);
  }
}
