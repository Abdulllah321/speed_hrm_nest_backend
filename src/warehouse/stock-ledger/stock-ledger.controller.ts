import { Controller, Get, Query } from '@nestjs/common';
import { StockLedgerService } from './stock-ledger.service';
import { MovementType } from '@prisma/client';

@Controller('api/stock-ledger')
export class StockLedgerController {
  constructor(private readonly stockLedgerService: StockLedgerService) { }

  @Get('levels')
  async getStockLevels(@Query('warehouseId') warehouseId?: string, @Query('locationId') locationId?: string) {
    return this.stockLedgerService.getStockLevels({ warehouseId, locationId });
  }

  @Get()
  async findAll(
    @Query('warehouseId') warehouseId?: string,
    @Query('movementType') movementType?: MovementType,
    @Query('itemId') itemId?: string,
    @Query('referenceType') referenceType?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.stockLedgerService.findAll({
      warehouseId,
      movementType,
      itemId,
      referenceType,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
