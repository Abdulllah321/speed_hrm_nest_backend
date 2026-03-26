import { Controller, Get, Post, Body, Query, Param } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Inventory')
@Controller('api/inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) { }

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
  async getDetailedStock(@Param('itemId') itemId: string) {
    const data = await this.inventoryService.getDetailedStock(itemId);
    return { status: true, data };
  }

  @Get('search')
  @ApiOperation({ summary: 'Search generic inventory items and aggregated stock' })
  async searchInventory(
    @Query('q') query: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    const data = await this.inventoryService.searchInventory(query, warehouseId);
    return { status: true, data };
  }
}
