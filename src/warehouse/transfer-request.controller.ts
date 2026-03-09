import { Controller, Post, Get, Patch, Body, Param, Query } from '@nestjs/common';
import { TransferRequestService } from './transfer-request.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Transfer Request')
@Controller('api/transfer-request')
export class TransferRequestController {
    constructor(private readonly transferRequestService: TransferRequestService) { }

    @Post()
    @ApiOperation({ summary: 'Create a new transfer request' })
    async create(@Body() dto: { fromWarehouseId: string; toWarehouseId: string; items: { itemId: string; quantity: number }[]; createdById?: string }) {
        const data = await this.transferRequestService.createRequest(dto);
        return { status: true, data, message: 'Transfer request created successfully' };
    }

    @Get()
    @ApiOperation({ summary: 'Get transfer requests for a warehouse' })
    async getRequests(@Query('warehouseId') warehouseId: string) {
        const data = await this.transferRequestService.getRequests(warehouseId);
        return { status: true, data };
    }

    @Patch(':id/status')
    @ApiOperation({ summary: 'Update transfer request status' })
    async updateStatus(@Param('id') id: string, @Body() dto: { status: string; approvedById?: string }) {
        const data = await this.transferRequestService.updateStatus(id, dto.status, dto.approvedById);
        return { status: true, data, message: `Request ${dto.status} successfully` };
    }
}
