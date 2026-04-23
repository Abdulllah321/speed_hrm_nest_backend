import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Query,
    Req,
    UseGuards,
    BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PosSalesService } from './pos-sales.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import * as jwt from 'jsonwebtoken';

@ApiTags('POS Sales')
@Controller('api/pos-sales')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class PosSalesController {
    constructor(private readonly posSalesService: PosSalesService) { }

    // ─── Item lookup for POS (search by barcode, SKU, description) ────
    @Get('lookup')
    @ApiOperation({ summary: 'Search items for POS by barcode/SKU/name' })
    async lookupItem(@Query('q') query: string, @Req() req: any) {
        const locationId = req.user?.locationId || this.extractLocationFromCookie(req);
        if (!locationId) {
            throw new BadRequestException('Location context is required for POS search');
        }
        return this.posSalesService.lookupItem(query, locationId);
    }

    // ─── Barcode scan — exact match, single item ──────────────────────
    @Get('scan')
    @ApiOperation({ summary: 'Scan barcode — exact match single item' })
    async scanBarcode(@Query('barcode') barcode: string, @Req() req: any) {
        const locationId = req.user?.locationId || this.extractLocationFromCookie(req);
        if (!locationId) {
            throw new BadRequestException('Location context is required for POS scan');
        }
        return this.posSalesService.scanBarcode(barcode, locationId);
    }

    private extractLocationFromCookie(req: any): string | undefined {
        if (req.cookies?.posTerminalToken) {
            try {
                const decoded: any = jwt.decode(req.cookies.posTerminalToken);
                return decoded?.locationId;
            } catch (e) {
                return undefined;
            }
        }
        return undefined;
    }

    // ─── Create a sales order (checkout) ──────────────────────────────
    @Post('orders')
    @Permissions('pos.sale.create')
    @ApiOperation({ summary: 'Create a sales order / checkout' })
    async createOrder(@Body() dto: CreateSalesOrderDto, @Req() req: any) {
        const cashierUserId = req.user?.id;

        // 1. Context from req.user (Preferred - comes from combined cashier token)
        if (req.user?.isPosUser || req.user?.isTerminal) {
            if (!dto.terminalId) dto.terminalId = req.user.terminalId;
            if (!dto.posId) dto.posId = req.user.posId;
            if (!dto.locationId) dto.locationId = req.user.locationId;
        }

        // 2. Fallback: Extract from specialized terminal cookie if still missing
        if ((!dto.terminalId || !dto.posId) && req.cookies?.posTerminalToken) {
            try {
                const decoded: any = jwt.decode(req.cookies.posTerminalToken);
                if (decoded) {
                    if (!dto.terminalId) dto.terminalId = decoded.terminalId;
                    if (!dto.posId) dto.posId = decoded.posId;
                    if (!dto.locationId) dto.locationId = decoded.locationId;
                }
            } catch (e) {
                // Ignore decoding errors
            }
        }

        return this.posSalesService.createOrder(dto, cashierUserId);
    }

    // ─── List orders (Sales History) ───────────────────────────────────
    @Get('orders')
    @Permissions('pos.sales.history.view')
    @ApiOperation({ summary: 'List sales orders / Sales History' })
    async listOrders(
        @Req() req: any,
        @Query('page') page?: number,
        @Query('limit') limit?: number,
        @Query('posId') posId?: string, // This could be Code or UUID from frontend filter
        @Query('status') status?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('search') search?: string,
    ) {
        // Determine effective filtering context
        let effectivePosId = posId; // The ID/Code to filter by
        let effectiveLocationId: string | undefined = undefined;

        // 1. Context from logged-in user
        if (req.user?.isPosUser || req.user?.isTerminal) {
            if (!effectivePosId) effectivePosId = req.user.posId || req.user.terminalId;
            effectiveLocationId = req.user.locationId;
        }

        // 2. Fallback to terminal cookie
        if (!effectivePosId && req.cookies?.posTerminalToken) {
            try {
                const decoded: any = jwt.decode(req.cookies.posTerminalToken);
                effectivePosId = decoded?.posId || decoded?.terminalId;
                if (!effectiveLocationId) effectiveLocationId = decoded?.locationId;
            } catch (e) { }
        }

        // 3. Fallback: any user with a locationId on their token (e.g. manager/admin scoped to a location)
        if (!effectiveLocationId && req.user?.locationId) {
            effectiveLocationId = req.user.locationId;
        }

        return this.posSalesService.listOrders(
            req.user,
            page ? Number(page) : 1,
            limit ? Number(limit) : 20,
            effectivePosId,
            status,
            { startDate, endDate, search },
            effectiveLocationId,
        );
    }

    // ─── Get return details for printing return slip ──────────────────
    // IMPORTANT: This must come BEFORE @Get('orders/:id') to avoid route conflict
    @Get('orders/:id/return-details')
    @ApiOperation({ summary: 'Get return details for printing return slip' })
    async getReturnDetails(@Param('id') id: string) {
        return this.posSalesService.getReturnDetails(id);
    }

    // ─── Get single order ─────────────────────────────────────────────
    @Get('orders/:id')
    @ApiOperation({ summary: 'Get sales order by ID' })
    async getOrder(@Param('id') id: string) {
        return this.posSalesService.getOrder(id);
    }


    @Post('orders/:id/return')
    @Permissions('pos.return.create')
    @ApiOperation({ summary: 'Process a partial or full return for a sales order' })
    async returnOrder(
        @Param('id') id: string,
        @Body() body: { items: { orderItemId: string; itemId: string; quantity: number }[]; reason?: string },
        @Req() req: any,
    ) {
        const returnLocationId = req.user?.locationId;
        return this.posSalesService.returnItems(id, body.items, body.reason, returnLocationId);
    }

    // ─── Exchange items ───────────────────────────────────────────────
    @Post('orders/:id/exchange')
    @Permissions('pos.exchange.create')
    @ApiOperation({ summary: 'Exchange items — return old items, issue new items' })
    async exchangeOrder(
        @Param('id') id: string,
        @Body() body: {
            returnedItems: { orderItemId: string; itemId: string; quantity: number }[];
            newItems: { itemId: string; quantity: number; unitPrice: number }[];
            reason?: string;
        },
    ) {
        return this.posSalesService.exchangeItems(id, body.returnedItems, body.newItems, body.reason);
    }

    // ─── Refund only (no stock movement) ─────────────────────────────
    @Post('orders/:id/refund')
    @ApiOperation({ summary: 'Refund only — money back, no stock movement' })
    async refundOrder(
        @Param('id') id: string,
        @Body() body: { refundAmount: number; reason?: string },
    ) {
        return this.posSalesService.refundOnly(id, body.refundAmount, body.reason);
    }

    // ─── Void order ───────────────────────────────────────────────────
    @Post('orders/:id/void')
    @ApiOperation({ summary: 'Void a sales order' })
    async voidOrder(@Param('id') id: string) {
        return this.posSalesService.voidOrder(id);
    }

    // ─── Hold order ───────────────────────────────────────────────────
    @Post('orders/hold')
    @Permissions('pos.hold.create')
    @ApiOperation({ summary: 'Place current cart on hold (max 1 hour / cleared at midnight)' })
    async holdOrder(@Body() dto: CreateSalesOrderDto, @Req() req: any) {
        const cashierUserId = req.user?.id;
        if (req.user?.isPosUser || req.user?.isTerminal) {
            if (!dto.terminalId) dto.terminalId = req.user.terminalId;
            if (!dto.posId) dto.posId = req.user.posId;
            if (!dto.locationId) dto.locationId = req.user.locationId;
        }
        if ((!dto.terminalId || !dto.posId) && req.cookies?.posTerminalToken) {
            try {
                const decoded: any = jwt.decode(req.cookies.posTerminalToken);
                if (decoded) {
                    if (!dto.terminalId) dto.terminalId = decoded.terminalId;
                    if (!dto.posId) dto.posId = decoded.posId;
                    if (!dto.locationId) dto.locationId = decoded.locationId;
                }
            } catch (e) { }
        }
        return this.posSalesService.holdOrder(dto, cashierUserId);
    }

    // ─── Resume hold order ────────────────────────────────────────────
    @Post('orders/:id/resume')
    @Permissions('pos.hold.resume')
    @ApiOperation({ summary: 'Resume a held order — returns cart items' })
    async resumeHoldOrder(@Param('id') id: string) {
        return this.posSalesService.resumeHoldOrder(id);
    }

    // ─── Cancel hold order ────────────────────────────────────────────
    @Post('orders/:id/cancel-hold')
    @ApiOperation({ summary: 'Cancel a held order — restores stock' })
    async cancelHoldOrder(@Param('id') id: string) {
        return this.posSalesService.cancelHoldOrder(id);
    }

    // ─── List hold orders ─────────────────────────────────────────────
    @Get('orders/holds')
    @Permissions('pos.hold.view')
    @ApiOperation({ summary: 'List active hold orders for this POS/location' })
    async listHoldOrders(@Req() req: any, @Query('posId') posId?: string, @Query('locationId') locationId?: string) {
        let effectivePosId = posId;
        let effectiveLocationId = locationId;
        if (req.user?.isPosUser || req.user?.isTerminal) {
            if (!effectivePosId) effectivePosId = req.user.posId;
            if (!effectiveLocationId) effectiveLocationId = req.user.locationId;
        }
        return this.posSalesService.listHoldOrders(effectivePosId, effectiveLocationId);
    }

    // ─── Clear expired holds (internal / cron) ────────────────────────
    @Post('orders/clear-expired-holds')
    @ApiOperation({ summary: 'Clear all expired hold orders (called by scheduler)' })
    async clearExpiredHolds() {
        return this.posSalesService.clearExpiredHolds();
    }
}
