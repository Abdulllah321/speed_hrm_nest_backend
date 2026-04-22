import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { StockMovementService } from './stock-movement.service';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';

@ApiTags('Stock Operations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('stock-operation')
export class StockOperationController {
  constructor(private readonly stockMovementService: StockMovementService) {}

  @Post('move')
  @Permissions('pos.stock.move')
  @ApiOperation({
    summary: 'Execute a stock movement (Inbound/Outbound/Transfer)',
  })
  executeMovement(@Body() dto: any) {
    return this.stockMovementService.executeMovement(dto);
  }
}
