import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PosConfigService } from './pos-config.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('POS Configuration')
@Controller('api/pos-config')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PosConfigController {
    constructor(private readonly service: PosConfigService) { }

    // ══════════════════════════════════════════════════════════════
    //  PROMO CAMPAIGNS
    // ══════════════════════════════════════════════════════════════

    @Get('promos')
    @ApiOperation({ summary: 'List all promo campaigns' })
    async listPromos() {
        return this.service.listPromos();
    }

    @Post('promos')
    @ApiOperation({ summary: 'Create a promo campaign' })
    async createPromo(@Body() body: any) {
        return this.service.createPromo(body);
    }

    @Put('promos/:id')
    @ApiOperation({ summary: 'Update a promo campaign' })
    async updatePromo(@Param('id') id: string, @Body() body: any) {
        return this.service.updatePromo(id, body);
    }

    @Delete('promos/:id')
    @ApiOperation({ summary: 'Delete a promo campaign' })
    async deletePromo(@Param('id') id: string) {
        return this.service.deletePromo(id);
    }

    // ══════════════════════════════════════════════════════════════
    //  COUPON CODES
    // ══════════════════════════════════════════════════════════════

    @Get('coupons')
    @ApiOperation({ summary: 'List all coupon codes' })
    async listCoupons() {
        return this.service.listCoupons();
    }

    @Post('coupons')
    @ApiOperation({ summary: 'Create a coupon code' })
    async createCoupon(@Body() body: any) {
        return this.service.createCoupon(body);
    }

    @Put('coupons/:id')
    @ApiOperation({ summary: 'Update a coupon code' })
    async updateCoupon(@Param('id') id: string, @Body() body: any) {
        return this.service.updateCoupon(id, body);
    }

    @Delete('coupons/:id')
    @ApiOperation({ summary: 'Delete a coupon code' })
    async deleteCoupon(@Param('id') id: string) {
        return this.service.deleteCoupon(id);
    }

    // ══════════════════════════════════════════════════════════════
    //  ALLIANCE DISCOUNTS
    // ══════════════════════════════════════════════════════════════

    @Get('alliances')
    @ApiOperation({ summary: 'List all alliance discounts' })
    async listAlliances() {
        return this.service.listAlliances();
    }

    @Post('alliances')
    @ApiOperation({ summary: 'Create an alliance discount' })
    async createAlliance(@Body() body: any) {
        return this.service.createAlliance(body);
    }

    @Put('alliances/:id')
    @ApiOperation({ summary: 'Update an alliance discount' })
    async updateAlliance(@Param('id') id: string, @Body() body: any) {
        return this.service.updateAlliance(id, body);
    }

    @Delete('alliances/:id')
    @ApiOperation({ summary: 'Delete an alliance discount' })
    async deleteAlliance(@Param('id') id: string) {
        return this.service.deleteAlliance(id);
    }

    // ══════════════════════════════════════════════════════════════
    //  POS-FACING ENDPOINTS
    // ══════════════════════════════════════════════════════════════

    @Get('checkout-config')
    @ApiOperation({ summary: 'Get active promos + alliances for a location (POS checkout)' })
    async getCheckoutConfig(
        @Req() req: any,
        @Query('locationId') locationIdParam?: string,
    ) {
        // Prefer locationId embedded in the posTerminalToken cookie (set during terminal setup)
        let locationId = locationIdParam || '';
        const posTerminalToken = req.cookies?.['posTerminalToken'];
        if (posTerminalToken) {
            try {
                const jwt = require('jsonwebtoken');
                const decoded: any = jwt.decode(posTerminalToken);
                if (decoded?.locationId) {
                    locationId = decoded.locationId;
                }
            } catch { /* fall back to query param */ }
        }
        return this.service.getCheckoutConfig(locationId);
    }

    @Post('validate-coupon')
    @ApiOperation({ summary: 'Validate a coupon code for a location' })    async validateCoupon(
        @Req() req: any,
        @Body() body: { code: string; locationId?: string; orderSubtotal: number },
    ) {
        let locationId = body.locationId || '';
        const posTerminalToken = req.cookies?.['posTerminalToken'];
        if (posTerminalToken) {
            try {
                const jwt = require('jsonwebtoken');
                const decoded: any = jwt.decode(posTerminalToken);
                if (decoded?.locationId) locationId = decoded.locationId;
            } catch { /* fall back to body */ }
        }
        return this.service.validateCoupon(body.code, locationId, body.orderSubtotal);
    }

    // ══════════════════════════════════════════════════════════════
    //  VOUCHERS
    // ══════════════════════════════════════════════════════════════

    @Get('vouchers')
    @ApiOperation({ summary: 'List all POS-issued vouchers' })
    async listVouchers() {
        return this.service.listVouchers();
    }

    @Post('vouchers')
    @ApiOperation({ summary: 'Issue a new voucher from POS' })
    async createVoucher(
        @Req() req: any,
        @Body() body: { amount: number; description?: string; expiresAt?: string },
    ) {
        // Attach issuer context from terminal token if available
        let issuedBy: string | undefined;
        const posTerminalToken = req.cookies?.['posTerminalToken'];
        if (posTerminalToken) {
            try {
                const jwt = require('jsonwebtoken');
                const decoded: any = jwt.decode(posTerminalToken);
                issuedBy = decoded?.posId ?? decoded?.terminalId;
            } catch { /* ignore */ }
        }
        return this.service.createVoucher({ ...body, issuedBy });
    }

    @Put('vouchers/:id/deactivate')
    @ApiOperation({ summary: 'Deactivate a voucher' })
    async deactivateVoucher(@Param('id') id: string) {
        return this.service.deactivateVoucher(id);
    }

    @Delete('vouchers/:id')
    @ApiOperation({ summary: 'Delete an unused voucher' })
    async deleteVoucher(@Param('id') id: string) {
        return this.service.deleteVoucher(id);
    }
}
