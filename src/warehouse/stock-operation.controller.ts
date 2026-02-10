import { Controller, Post, Body } from '@nestjs/common';
import { StockMovementService } from './stock-movement.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Stock Operations')
@Controller('stock-operation')
export class StockOperationController {
    constructor(private readonly stockMovementService: StockMovementService) { }

    @Post('move')
    @ApiOperation({ summary: 'Execute a stock movement (Inbound/Outbound/Transfer)' })
    executeMovement(@Body() dto: any) {
        return this.stockMovementService.executeMovement(dto);
    }
}
