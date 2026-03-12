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
        fromWarehouseId?: string;
        fromLocationId?: string;
        toLocationId?: string;
        transferType?: 'WAREHOUSE_TO_OUTLET' | 'OUTLET_TO_WAREHOUSE';
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

    @Get('return-requests')
    @ApiOperation({ summary: 'Get return requests for a location (outlet to warehouse)' })
    async getReturnRequests(@Query('locationId') locationId: string) {
        const data = await this.transferRequestService.getReturnRequests(locationId);
        return { status: true, data };
    }

    @Get('outbound-requests')
    @ApiOperation({ summary: 'Get outbound requests for source approval (outlet to outlet)' })
    async getOutboundRequests(@Query('locationId') locationId: string) {
        const data = await this.transferRequestService.getOutboundRequests(locationId);
        return { status: true, data };
    }

    @Get('inbound-requests')
    @ApiOperation({ summary: 'Get inbound requests for destination acceptance (outlet to outlet)' })
    async getInboundRequests(@Query('locationId') locationId: string) {
        const data = await this.transferRequestService.getInboundRequests(locationId);
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

    @Post(':id/approve-source')
    @ApiOperation({ summary: 'Approve transfer at source outlet (outlet to outlet only)' })
    async approveSource(@Param('id') id: string, @Body() dto: { userId?: string }) {
        const data = await this.transferRequestService.approveSource(id, dto.userId);
        return { status: true, data, message: 'Source approval completed. Awaiting destination acceptance.' };
    }
}
