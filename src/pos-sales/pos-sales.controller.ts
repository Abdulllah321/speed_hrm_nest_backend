import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Query,
    Req,
    Res,
    UseGuards,
    BadRequestException,
    Patch,
} from '@nestjs/common';
import { NetSalesSummaryExportService } from './net-sales-summary-export.service';
import { SalesRegisterExportService } from './sales-register-export.service';
import { SalesListExportService } from './sales-list-export.service';
import { GrossSalesExportService } from './gross-sales-export.service';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PosSalesService } from './pos-sales.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CustomerService } from '../sales/customer/customer.service';
import { CreateCustomerDto, UpdateCustomerDto } from '../sales/customer/dto/customer-dto';
import * as jwt from 'jsonwebtoken';

@ApiTags('POS Sales')
@Controller('api/pos-sales')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class PosSalesController {
    constructor(
        private readonly posSalesService: PosSalesService,
        private readonly customerService: CustomerService,
        private readonly netSalesSummaryExportService: NetSalesSummaryExportService,
        private readonly salesRegisterExportService: SalesRegisterExportService,
        private readonly salesListExportService: SalesListExportService,
        private readonly grossSalesExportService: GrossSalesExportService,
    ) { }

    // ─── POS Customer Endpoints ────────────────────────────────────────
    // These mirror /api/sales/customers but are mounted under /api/pos-sales/customers
    // so the POS frontend has a single base URL and doesn't need to cross modules.

    @Post('customers')
    @ApiOperation({ summary: 'Create a new customer from POS' })
    async createCustomer(@Body() dto: CreateCustomerDto, @Req() req: any) {
        const ctx = {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        };
        return this.customerService.posCreate(dto, ctx);
    }

    @Get('customers')
    @ApiOperation({ summary: 'Search / list customers from POS' })
    async listCustomers(@Query('search') search?: string) {
        return this.customerService.posFindAll(search);
    }

    @Get('customers/:id')
    @ApiOperation({ summary: 'Get a single customer by ID' })
    async getCustomer(@Param('id') id: string) {
        return this.customerService.findOne(id);
    }

    @Patch('customers/:id')
    @ApiOperation({ summary: 'Update a customer from POS' })
    async updateCustomer(
        @Param('id') id: string,
        @Body() dto: UpdateCustomerDto,
        @Req() req: any,
    ) {
        const ctx = {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        };
        return this.customerService.update(id, dto, ctx);
    }

    @Post('customers/:id/pay-credit')
    @ApiOperation({ summary: 'Record credit payment for a customer — marks selected orders as paid' })
    async recordCreditPayment(
        @Param('id') id: string,
        @Body() dto: { orderIds: string[]; paymentMethod: string; notes?: string; cardLast4?: string; slipRef?: string },
        @Req() req: any,
    ) {
        const ctx = {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        };
        return this.customerService.recordCreditPayment(id, dto, ctx);
    }

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
        // Use cashierUserId from DTO if provided (manual selection on checkout), 
        // otherwise fall back to the logged-in user's ID
        const cashierUserId = dto.cashierUserId || req.user?.id;

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

        const ctx = {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        };

        return this.posSalesService.createOrder(dto, cashierUserId, ctx);
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

    // ─── List sales activities (Activity Log) ─────────────────────────
    @Get('activities')
    @Permissions('pos.sales.history.view')
    @ApiOperation({ summary: 'List sales activities (sales, returns, refunds, claims)' })
    async listActivities(
        @Req() req: any,
        @Query('page') page?: number,
        @Query('limit') limit?: number,
        @Query('posId') posId?: string,
        @Query('activityType') activityType?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('search') search?: string,
    ) {
        // Determine effective filtering context
        let effectivePosId = posId;
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

        // 3. Fallback: any user with a locationId on their token
        if (!effectiveLocationId && req.user?.locationId) {
            effectiveLocationId = req.user.locationId;
        }

        return this.posSalesService.listSalesActivities(
            req.user,
            page ? Number(page) : 1,
            limit ? Number(limit) : 20,
            effectivePosId,
            activityType,
            { startDate, endDate, search },
            effectiveLocationId,
        );
    }


    // ─── Get return details for printing return slip ──────────────────
    // IMPORTANT: This must come BEFORE @Get('orders/:id') to avoid route conflict
    @Get('orders/:id/return-details')
    @ApiOperation({ summary: 'Get return details for printing return slip' })
    async getReturnDetails(@Param('id') id: string, @Query('type') type?: 'return' | 'refund') {
        return this.posSalesService.getReturnDetails(id, type);
    }

    // ─── List hold orders ─────────────────────────────────────────────
    // IMPORTANT: Must be BEFORE @Get('orders/:id') — otherwise 'holds' is matched as :id
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
        const ctx = {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        };
        return this.posSalesService.returnItems(id, body.items, body.reason, returnLocationId, ctx);
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
        @Req() req: any,
    ) {
        const ctx = {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        };
        return this.posSalesService.exchangeItems(id, body.returnedItems, body.newItems, body.reason, ctx);
    }

    // ─── Refund only (no stock movement) ─────────────────────────────
    @Post('orders/:id/refund')
    @ApiOperation({ summary: 'Refund only — money back, no stock movement' })
    async refundOrder(
        @Param('id') id: string,
        @Body() body: { refundAmount: number; items?: { orderItemId: string; itemId: string; quantity: number }[]; reason?: string; managerUserId?: string },
        @Req() req: any,
    ) {
        const ctx = {
            userId: body.managerUserId || req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        };
        return this.posSalesService.refundOnly(id, body.refundAmount, body.items, body.reason, ctx);
    }

    // ─── Void order ───────────────────────────────────────────────────
    @Post('orders/:id/void')
    @ApiOperation({ summary: 'Void a sales order' })
    async voidOrder(@Param('id') id: string, @Req() req: any) {
        const ctx = {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        };
        return this.posSalesService.voidOrder(id, ctx);
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
        const ctx = {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        };
        return this.posSalesService.holdOrder(dto, cashierUserId, ctx);
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
    async cancelHoldOrder(@Param('id') id: string, @Req() req: any) {
        const ctx = {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        };
        return this.posSalesService.cancelHoldOrder(id, ctx);
    }

    // ─── Clear expired holds (internal / cron) ────────────────────────
    @Post('orders/clear-expired-holds')
    @ApiOperation({ summary: 'Clear all expired hold orders (called by scheduler)' })
    async clearExpiredHolds() {
        return this.posSalesService.clearExpiredHolds();
    }

    // ─── List available cashiers for a location ─────────────────────
    @Get('cashiers')
    @ApiOperation({ summary: 'List employees/users available as cashiers for a location' })
    async listCashiers(@Req() req: any, @Query('locationId') locationId?: string) {
        const effectiveLocationId = locationId || req.user?.locationId || this.extractLocationFromCookie(req);
        if (!effectiveLocationId) {
            throw new BadRequestException('Location ID is required to list cashiers');
        }
        return this.posSalesService.listCashiers(effectiveLocationId);
    }

    // ─── Update tender ────────────────────────────────────────────────
    @Post('orders/:id/update-tender')
    @Permissions('pos.sales.history.update-tender')
    @ApiOperation({ summary: 'Update payment tender on an existing order' })
    async updateTender(
        @Param('id') id: string,
        @Body() body: { tenders: { method: string; amount: number; cardLast4?: string; slipNo?: string }[], merchantId?: string },
        @Req() req: any,
    ) {
        return this.posSalesService.updateTender(id, body.tenders, body.merchantId, {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers?.['user-agent'],
        });
    }

    // ─── Sales Report ─────────────────────────────────────────────────
    @Get('reports/sales')
    @Permissions('pos.dashboard.view')
    @ApiOperation({ summary: 'POS Sales Report — summary, trends, top items, cashier stats, paginated orders' })
    async getSalesReport(
        @Req() req: any,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('locationId') locationId?: string,
        @Query('cashierUserId') cashierUserId?: string,
        @Query('paymentMethod') paymentMethod?: string,
        @Query('status') status?: string,
        @Query('groupBy') groupBy?: 'day' | 'week' | 'month',
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('search') search?: string,
    ) {
        // Scope to user's location if they are a POS user
        let effectiveLocationId = locationId;
        if (!effectiveLocationId) {
            if (req.user?.isPosUser || req.user?.isTerminal) {
                effectiveLocationId = req.user.locationId;
            } else if (req.user?.locationId) {
                effectiveLocationId = req.user.locationId;
            }
        }
        if (!effectiveLocationId && req.cookies?.posTerminalToken) {
            try {
                const decoded: any = jwt.decode(req.cookies.posTerminalToken);
                effectiveLocationId = decoded?.locationId;
            } catch (e) { }
        }

        return this.posSalesService.getSalesReport(req.user, {
            startDate,
            endDate,
            locationId: effectiveLocationId,
            cashierUserId,
            paymentMethod,
            status,
            groupBy,
            page: page ? Number(page) : 1,
            limit: limit ? Number(limit) : 50,
            search,
        });
    }

    // ─── Net Sales Summary Endpoints ───────────────────────────────

    @Get('reports/net-sales-summary')
    @ApiOperation({ summary: 'Get Net Sales Summary Report' })
    async getNetSalesSummary(
        @Query('locationId') locationId: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('cashierUserId') cashierUserId?: string,
        @Query('summaryOnly') summaryOnly?: string,
        @Query('showSalesperson') showSalesperson?: string,
        @Query('showYear') showYear?: string,
        @Query('showMonth') showMonth?: string,
        @Query('showDay') showDay?: string,
        @Query('showDocument') showDocument?: string,
        @Query('showBrand') showBrand?: string,
        @Query('showDivision') showDivision?: string,
        @Query('showSalesTax') showSalesTax?: string,
        @Query('showCategory') showCategory?: string,
        @Query('showGender') showGender?: string,
        @Query('showSilhouette') showSilhouette?: string,
        @Query('showArticle') showArticle?: string,
        @Query('showVariant') showVariant?: string,
    ) {
        return this.posSalesService.getNetSalesSummaryReport({
            locationId,
            startDate,
            endDate,
            cashierUserId,
            summaryOnly: summaryOnly === 'true',
            showSalesperson: showSalesperson === 'true',
            showYear: showYear === 'true',
            showMonth: showMonth === 'true',
            showDay: showDay === 'true',
            showDocument: showDocument === 'true',
            showBrand: showBrand !== undefined ? showBrand === 'true' : undefined,
            showDivision: showDivision !== undefined ? showDivision === 'true' : undefined,
            showSalesTax: showSalesTax === 'true',
            showCategory: showCategory !== undefined ? showCategory === 'true' : undefined,
            showGender: showGender !== undefined ? showGender === 'true' : undefined,
            showSilhouette: showSilhouette !== undefined ? showSilhouette === 'true' : undefined,
            showArticle: showArticle !== undefined ? showArticle === 'true' : undefined,
            showVariant: showVariant !== undefined ? showVariant === 'true' : undefined,
        });
    }

    @Post('reports/net-sales-summary/export/queue')
    @ApiOperation({ summary: 'Queue Net Sales Summary Export' })
    async queueNetSalesSummaryExport(
        @Req() req: any,
        @Body() body: {
            locationId: string;
            startDate?: string;
            endDate?: string;
            cashierUserId?: string;
            format: 'xlsx' | 'pdf';
            summaryOnly?: boolean;
            showSalesperson?: boolean;
            showYear?: boolean;
            showMonth?: boolean;
            showDay?: boolean;
            showDocument?: boolean;
            showBrand?: boolean;
            showDivision?: boolean;
            showSalesTax?: boolean;
            showCategory?: boolean;
            showGender?: boolean;
            showSilhouette?: boolean;
            showArticle?: boolean;
            showVariant?: boolean;
        },
    ) {
        const userId = req.user?.userId || req.user?.id;
        const result = await this.netSalesSummaryExportService.queueExport({
            userId,
            locationId: body.locationId,
            startDate: body.startDate,
            endDate: body.endDate,
            cashierUserId: body.cashierUserId,
            format: body.format,
            summaryOnly: body.summaryOnly,
            showSalesperson: body.showSalesperson,
            showYear: body.showYear,
            showMonth: body.showMonth,
            showDay: body.showDay,
            showDocument: body.showDocument,
            showBrand: body.showBrand,
            showDivision: body.showDivision,
            showSalesTax: body.showSalesTax,
            showCategory: body.showCategory,
            showGender: body.showGender,
            showSilhouette: body.showSilhouette,
            showArticle: body.showArticle,
            showVariant: body.showVariant,
        });
        return { status: true, data: result };
    }

    @Get('reports/net-sales-summary/export/:jobId/status')
    @ApiOperation({ summary: 'Get Net Sales Summary Export Status' })
    async getNetSalesSummaryExportStatus(@Param('jobId') jobId: string) {
        const result = await this.netSalesSummaryExportService.getJobStatus(jobId);
        return { status: true, data: result };
    }

    @Get('reports/net-sales-summary/export/:jobId/download')
    @ApiOperation({ summary: 'Download Net Sales Summary Export' })
    async downloadNetSalesSummaryExport(@Param('jobId') jobId: string, @Res() res: any) {
        try {
            await this.netSalesSummaryExportService.streamExportFile(jobId, res);
        } catch (err: any) {
            const status = err?.status ?? 404;
            res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
        }
    }

    // ─── Sales Register Report Endpoints ────────────────────────────

    @Get('reports/sales-register')
    @ApiOperation({ summary: 'Get Sales Register Report' })
    async getSalesRegister(
        @Query('locationId') locationId: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('cashierUserId') cashierUserId?: string,
        @Query('search') search?: string,
    ) {
        return this.posSalesService.getSalesRegisterReport({
            locationId,
            startDate,
            endDate,
            cashierUserId,
            search,
        });
    }

    @Post('reports/sales-register/export/queue')
    @ApiOperation({ summary: 'Queue Sales Register Export' })
    async queueSalesRegisterExport(
        @Req() req: any,
        @Body() body: {
            locationId: string;
            startDate?: string;
            endDate?: string;
            cashierUserId?: string;
            format: 'xlsx' | 'pdf';
            search?: string;
        },
    ) {
        const userId = req.user?.userId || req.user?.id;
        const result = await this.salesRegisterExportService.queueExport({
            userId,
            locationId: body.locationId,
            startDate: body.startDate,
            endDate: body.endDate,
            cashierUserId: body.cashierUserId,
            format: body.format,
            search: body.search,
        });
        return { status: true, data: result };
    }

    @Get('reports/sales-register/export/:jobId/status')
    @ApiOperation({ summary: 'Get Sales Register Export Status' })
    async getSalesRegisterExportStatus(@Param('jobId') jobId: string) {
        const result = await this.salesRegisterExportService.getJobStatus(jobId);
        return { status: true, data: result };
    }

    @Get('reports/sales-register/export/:jobId/download')
    @ApiOperation({ summary: 'Download Sales Register Export' })
    async downloadSalesRegisterExport(@Param('jobId') jobId: string, @Res() res: any) {
        try {
            await this.salesRegisterExportService.streamExportFile(jobId, res);
        } catch (err: any) {
            const status = err?.status ?? 404;
            res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
        }
    }

    // ─── Sales List Report Endpoints ─────────────────────────────────

    @Get('reports/sales-list')
    @ApiOperation({ summary: 'Get Sales List Report' })
    async getSalesList(
        @Query('locationId') locationId: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('cashierUserId') cashierUserId?: string,
        @Query('search') search?: string,
        @Query('paymentModeGroup') paymentModeGroup?: string,
        @Query('minAmount') minAmount?: number,
        @Query('maxAmount') maxAmount?: number,
        @Query('fbrOnly') fbrOnly?: string,
    ) {
        return this.posSalesService.getSalesListReport({
            locationId,
            startDate,
            endDate,
            cashierUserId,
            search,
            paymentModeGroup,
            minAmount: minAmount ? Number(minAmount) : undefined,
            maxAmount: maxAmount ? Number(maxAmount) : undefined,
            fbrOnly: fbrOnly === 'true' || fbrOnly === '1' ? true : undefined,
        });
    }

    @Post('reports/sales-list/export/queue')
    @ApiOperation({ summary: 'Queue Sales List Export' })
    async queueSalesListExport(
        @Req() req: any,
        @Body() body: {
            locationId: string;
            startDate?: string;
            endDate?: string;
            cashierUserId?: string;
            format: 'xlsx' | 'pdf';
            search?: string;
            paymentModeGroup?: string;
            minAmount?: number;
            maxAmount?: number;
            fbrOnly?: boolean;
        },
    ) {
        const userId = req.user?.userId || req.user?.id;
        const result = await this.salesListExportService.queueExport({
            userId,
            locationId: body.locationId,
            startDate: body.startDate,
            endDate: body.endDate,
            cashierUserId: body.cashierUserId,
            format: body.format,
            search: body.search,
            paymentModeGroup: body.paymentModeGroup,
            minAmount: body.minAmount,
            maxAmount: body.maxAmount,
            fbrOnly: body.fbrOnly,
        });
        return { status: true, data: result };
    }

    @Get('reports/sales-list/export/:jobId/status')
    @ApiOperation({ summary: 'Get Sales List Export Status' })
    async getSalesListExportStatus(@Param('jobId') jobId: string) {
        const result = await this.salesListExportService.getJobStatus(jobId);
        return { status: true, data: result };
    }

    @Get('reports/sales-list/export/:jobId/download')
    @ApiOperation({ summary: 'Download Sales List Export' })
    async downloadSalesListExport(@Param('jobId') jobId: string, @Res() res: any) {
        try {
            await this.salesListExportService.streamExportFile(jobId, res);
        } catch (err: any) {
            const status = err?.status ?? 404;
            res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
        }
    }

    // ─── Gross Sales Summary & Return Reports ─────────────────────────
    @Get('reports/gross-sales-summary')
    @ApiOperation({ summary: 'Get Gross Sales Summary Report' })
    async getGrossSalesSummary(
        @Query('locationId') locationId: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('cashierUserId') cashierUserId?: string,
        @Query('search') search?: string,
        @Query('paymentModeGroup') paymentModeGroup?: string,
        @Query('minAmount') minAmount?: string,
        @Query('maxAmount') maxAmount?: string,
        @Query('fbrOnly') fbrOnly?: string,
        @Query('showBrand') showBrand?: string,
        @Query('showDivision') showDivision?: string,
        @Query('showCategory') showCategory?: string,
        @Query('showGender') showGender?: string,
        @Query('showSilhouette') showSilhouette?: string,
        @Query('showArticle') showArticle?: string,
        @Query('showVariant') showVariant?: string,
        @Query('showInvoices') showInvoices?: string,
    ) {
        return this.posSalesService.getGrossSalesSummaryReport({
            locationId,
            startDate,
            endDate,
            cashierUserId,
            search,
            paymentModeGroup,
            minAmount: minAmount ? Number(minAmount) : undefined,
            maxAmount: maxAmount ? Number(maxAmount) : undefined,
            fbrOnly: fbrOnly === 'true' || fbrOnly === '1' ? true : undefined,
            showBrand: showBrand !== undefined ? showBrand === 'true' : undefined,
            showDivision: showDivision !== undefined ? showDivision === 'true' : undefined,
            showCategory: showCategory !== undefined ? showCategory === 'true' : undefined,
            showGender: showGender !== undefined ? showGender === 'true' : undefined,
            showSilhouette: showSilhouette !== undefined ? showSilhouette === 'true' : undefined,
            showArticle: showArticle !== undefined ? showArticle === 'true' : undefined,
            showVariant: showVariant !== undefined ? showVariant === 'true' : undefined,
            showInvoices: showInvoices !== undefined ? showInvoices === 'true' : undefined,
        });
    }

    @Post('reports/gross-sales-summary/export/queue')
    @ApiOperation({ summary: 'Queue Gross Sales Summary Export' })
    async queueGrossSalesSummaryExport(
        @Req() req: any,
        @Body() body: {
            locationId: string;
            startDate?: string;
            endDate?: string;
            cashierUserId?: string;
            format: 'xlsx' | 'pdf';
            search?: string;
            paymentModeGroup?: string;
            minAmount?: number;
            maxAmount?: number;
            fbrOnly?: boolean;
            showBrand?: boolean;
            showDivision?: boolean;
            showCategory?: boolean;
            showGender?: boolean;
            showSilhouette?: boolean;
            showArticle?: boolean;
            showVariant?: boolean;
            showInvoices?: boolean;
        },
    ) {
        const userId = req.user?.userId || req.user?.id;
        const result = await this.grossSalesExportService.queueExport({
            userId,
            locationId: body.locationId,
            startDate: body.startDate,
            endDate: body.endDate,
            cashierUserId: body.cashierUserId,
            format: body.format,
            search: body.search,
            paymentModeGroup: body.paymentModeGroup,
            minAmount: body.minAmount,
            maxAmount: body.maxAmount,
            fbrOnly: body.fbrOnly,
            showBrand: body.showBrand,
            showDivision: body.showDivision,
            showCategory: body.showCategory,
            showGender: body.showGender,
            showSilhouette: body.showSilhouette,
            showArticle: body.showArticle,
            showVariant: body.showVariant,
            showInvoices: body.showInvoices,
            reportType: 'summary',
        });
        return { status: true, data: result };
    }

    @Get('reports/gross-sales-return')
    @ApiOperation({ summary: 'Get Gross Sales Return Report' })
    async getGrossSalesReturn(
        @Query('locationId') locationId: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('cashierUserId') cashierUserId?: string,
        @Query('search') search?: string,
        @Query('paymentModeGroup') paymentModeGroup?: string,
        @Query('minAmount') minAmount?: string,
        @Query('maxAmount') maxAmount?: string,
        @Query('fbrOnly') fbrOnly?: string,
        @Query('showBrand') showBrand?: string,
        @Query('showDivision') showDivision?: string,
        @Query('showCategory') showCategory?: string,
        @Query('showGender') showGender?: string,
        @Query('showSilhouette') showSilhouette?: string,
        @Query('showArticle') showArticle?: string,
        @Query('showVariant') showVariant?: string,
        @Query('showInvoices') showInvoices?: string,
    ) {
        return this.posSalesService.getGrossSalesReturnReport({
            locationId,
            startDate,
            endDate,
            cashierUserId,
            search,
            paymentModeGroup,
            minAmount: minAmount ? Number(minAmount) : undefined,
            maxAmount: maxAmount ? Number(maxAmount) : undefined,
            fbrOnly: fbrOnly === 'true' || fbrOnly === '1' ? true : undefined,
            showBrand: showBrand !== undefined ? showBrand === 'true' : undefined,
            showDivision: showDivision !== undefined ? showDivision === 'true' : undefined,
            showCategory: showCategory !== undefined ? showCategory === 'true' : undefined,
            showGender: showGender !== undefined ? showGender === 'true' : undefined,
            showSilhouette: showSilhouette !== undefined ? showSilhouette === 'true' : undefined,
            showArticle: showArticle !== undefined ? showArticle === 'true' : undefined,
            showVariant: showVariant !== undefined ? showVariant === 'true' : undefined,
            showInvoices: showInvoices !== undefined ? showInvoices === 'true' : undefined,
        });
    }

    @Post('reports/gross-sales-return/export/queue')
    @ApiOperation({ summary: 'Queue Gross Sales Return Export' })
    async queueGrossSalesReturnExport(
        @Req() req: any,
        @Body() body: {
            locationId: string;
            startDate?: string;
            endDate?: string;
            cashierUserId?: string;
            format: 'xlsx' | 'pdf';
            search?: string;
            paymentModeGroup?: string;
            minAmount?: number;
            maxAmount?: number;
            fbrOnly?: boolean;
            showBrand?: boolean;
            showDivision?: boolean;
            showCategory?: boolean;
            showGender?: boolean;
            showSilhouette?: boolean;
            showArticle?: boolean;
            showVariant?: boolean;
            showInvoices?: boolean;
        },
    ) {
        const userId = req.user?.userId || req.user?.id;
        const result = await this.grossSalesExportService.queueExport({
            userId,
            locationId: body.locationId,
            startDate: body.startDate,
            endDate: body.endDate,
            cashierUserId: body.cashierUserId,
            format: body.format,
            search: body.search,
            paymentModeGroup: body.paymentModeGroup,
            minAmount: body.minAmount,
            maxAmount: body.maxAmount,
            fbrOnly: body.fbrOnly,
            showBrand: body.showBrand,
            showDivision: body.showDivision,
            showCategory: body.showCategory,
            showGender: body.showGender,
            showSilhouette: body.showSilhouette,
            showArticle: body.showArticle,
            showVariant: body.showVariant,
            showInvoices: body.showInvoices,
            reportType: 'return',
        });
        return { status: true, data: result };
    }

    @Get('reports/gross-sales-export/:jobId/status')
    @ApiOperation({ summary: 'Get Gross Sales Export Status' })
    async getGrossSalesExportStatus(@Param('jobId') jobId: string) {
        const result = await this.grossSalesExportService.getJobStatus(jobId);
        return { status: true, data: result };
    }

    @Get('reports/gross-sales-export/:jobId/download')
    @ApiOperation({ summary: 'Download Gross Sales Export' })
    async downloadGrossSalesExport(@Param('jobId') jobId: string, @Res() res: any) {
        try {
            await this.grossSalesExportService.streamExportFile(jobId, res);
        } catch (err: any) {
            const status = err?.status ?? 404;
            res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
        }
    }
}
