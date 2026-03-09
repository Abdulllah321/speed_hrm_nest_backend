import { Controller, Post, Get, Patch, Body, Param, Query } from '@nestjs/common';
import { TransferRequestService } from './transfer-request.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Transfer Request')
@Controller('api/transfer-request')
export class TransferRequestController {
    constructor(private readonly transferRequestService: TransferRequestService) { }

    @Post()
    @ApiOperation({ summary: 'Create a new transfer request' })
    async create(@Body() dto: {
        fromWarehouseId: string;
        toWarehouseId: string;
        fromLocationId?: string;
        toLocationId?: string;
        items: { itemId: string; quantity: number }[];
        createdById?: string;
        notes?: string;
    }) {
        const data = await this.transferRequestService.createRequest(dto);
        return { status: true, data, message: 'Transfer request created successfully' };
    }

    @Get()
    @ApiOperation({ summary: 'Get transfer requests' })
    async getRequests(@Query('warehouseId') warehouseId?: string, @Query('status') status?: string) {
        const data = await this.transferRequestService.getRequests(warehouseId, status);
        return { status: true, data };
    }

    @Get('incoming')
    @ApiOperation({ summary: 'Get incoming pending requests for a location' })
    async getIncoming(@Query('locationId') locationId: string) {
        const data = await this.transferRequestService.getIncomingRequests(locationId);
        return { status: true, data };
    }

    @Patch(':id/status')
    @ApiOperation({ summary: 'Update transfer request status' })
    async updateStatus(@Param('id') id: string, @Body() dto: { status: string; approvedById?: string }) {
        const data = await this.transferRequestService.updateStatus(id, dto.status, dto.approvedById);
        return { status: true, data, message: `Request ${dto.status} successfully` };
    }

    @Post(':id/accept')
    @ApiOperation({ summary: 'Accept and execute transfer movement' })
    async accept(@Param('id') id: string, @Body() dto: { userId?: string }) {
        const data = await this.transferRequestService.acceptRequest(id, dto.userId);
        return { status: true, data, message: 'Transfer accepted and stock moved successfully' };
    }
}
