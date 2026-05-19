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
import { VoucherService } from './voucher.service';
import { MerchantService } from './merchant.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';

@ApiTags('POS Configuration')
@Controller('api/pos-config')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PosConfigController {
    constructor(
        private readonly service: PosConfigService,
        private readonly voucherService: VoucherService,
        private readonly merchantService: MerchantService,
    ) { }

    // ══════════════════════════════════════════════════════════════
    //  PROMO CAMPAIGNS
    // ══════════════════════════════════════════════════════════════

    @Get('promos')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.promo.read'))
    @ApiOperation({ summary: 'List all promo campaigns' })
    async listPromos() {
        return this.service.listPromos();
    }

    @Get('promos/:id')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.promo.read'))
    @ApiOperation({ summary: 'Get a promo campaign by ID' })
    async getPromo(@Param('id') id: string) {
        return this.service.getPromoById(id);
    }

    @Post('promos')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.promo.create'))
    @ApiOperation({ summary: 'Create a promo campaign' })
    async createPromo(@Body() body: any, @Req() req: any) {
        return this.service.createPromo(body, {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }

    @Put('promos/:id')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.promo.update'))
    @ApiOperation({ summary: 'Update a promo campaign (also used for soft-deactivation)' })
    async updatePromo(@Param('id') id: string, @Body() body: any, @Req() req: any) {
        return this.service.updatePromo(id, body, {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  COUPON CODES
    // ══════════════════════════════════════════════════════════════

    @Get('coupons')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.coupon.read'))
    @ApiOperation({ summary: 'List all coupon codes' })
    async listCoupons() {
        return this.service.listCoupons();
    }

    @Get('coupons/:id')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.coupon.read'))
    @ApiOperation({ summary: 'Get a coupon code by ID' })
    async getCoupon(@Param('id') id: string) {
        return this.service.getCouponById(id);
    }

    @Post('coupons')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.coupon.create'))
    @ApiOperation({ summary: 'Create a coupon code' })
    async createCoupon(@Body() body: any, @Req() req: any) {
        return this.service.createCoupon(body, {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }

    @Put('coupons/:id')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.coupon.update'))
    @ApiOperation({ summary: 'Update a coupon code (also used for soft-deactivation)' })
    async updateCoupon(@Param('id') id: string, @Body() body: any, @Req() req: any) {
        return this.service.updateCoupon(id, body, {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  ALLIANCE DISCOUNTS
    // ══════════════════════════════════════════════════════════════

    @Get('alliances')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.alliance.read'))
    @ApiOperation({ summary: 'List all alliance discounts' })
    async listAlliances() {
        return this.service.listAlliances();
    }

    @Get('alliances/:id')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.alliance.read'))
    @ApiOperation({ summary: 'Get an alliance discount by ID' })
    async getAlliance(@Param('id') id: string) {
        return this.service.getAllianceById(id);
    }

    @Post('alliances')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.alliance.create'))
    @ApiOperation({ summary: 'Create an alliance discount' })
    async createAlliance(@Body() body: any, @Req() req: any) {
        return this.service.createAlliance(body, {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }

    @Put('alliances/:id')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.alliance.update'))
    @ApiOperation({ summary: 'Update an alliance discount (also used for soft-deactivation)' })
    async updateAlliance(@Param('id') id: string, @Body() body: any, @Req() req: any) {
        return this.service.updateAlliance(id, body, {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
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
    //  VOUCHERS (new Voucher model — separate from CouponCode)
    // ══════════════════════════════════════════════════════════════

    @Get('vouchers')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('pos.voucher.view')
    @ApiOperation({ summary: 'List vouchers' })
    async listVouchers(
        @Query('voucherType') voucherType?: string,
        @Query('locationId') locationId?: string,
        @Query('search') search?: string,
    ) {
        return this.voucherService.listVouchers({ voucherType, locationId, search });
    }

    @Get('vouchers/:id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('pos.voucher.view')
    @ApiOperation({ summary: 'Get voucher detail' })
    async getVoucher(@Param('id') id: string) {
        return this.voucherService.getVoucher(id);
    }

    @Post('vouchers')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('pos.voucher.create')
    @ApiOperation({ summary: 'Issue a new voucher' })
    async issueVoucher(@Req() req: any, @Body() body: any) {
        let issuedByLocationId: string | undefined;
        let issuedByUserId: string | undefined = req.user?.id;
        const posTerminalToken = req.cookies?.['posTerminalToken'];
        if (posTerminalToken) {
            try {
                const jwt = require('jsonwebtoken');
                const decoded: any = jwt.decode(posTerminalToken);
                if (decoded?.locationId) issuedByLocationId = decoded.locationId;
            } catch { /* ignore */ }
        }
        return this.voucherService.issueVoucher({ ...body, issuedByLocationId, issuedByUserId }, {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }

    @Post('vouchers/bulk')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('pos.voucher.create')
    @ApiOperation({ summary: 'Bulk issue vouchers (max 500)' })
    async bulkIssueVouchers(@Req() req: any, @Body() body: any) {
        let issuedByLocationId: string | undefined;
        let issuedByUserId: string | undefined = req.user?.id;
        const posTerminalToken = req.cookies?.['posTerminalToken'];
        if (posTerminalToken) {
            try {
                const jwt = require('jsonwebtoken');
                const decoded: any = jwt.decode(posTerminalToken);
                if (decoded?.locationId) issuedByLocationId = decoded.locationId;
            } catch { /* ignore */ }
        }
        return this.voucherService.bulkIssueVouchers({ ...body, issuedByLocationId, issuedByUserId }, {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }

    @Post('vouchers/validate')
    @ApiOperation({ summary: 'Validate a voucher code at checkout' })
    async validateVoucher(
        @Req() req: any,
        @Body() body: { code: string; locationId?: string; customerId?: string },
    ) {
        let locationId = body.locationId || '';
        const posTerminalToken = req.cookies?.['posTerminalToken'];
        if (posTerminalToken) {
            try {
                const jwt = require('jsonwebtoken');
                const decoded: any = jwt.decode(posTerminalToken);
                if (decoded?.locationId) locationId = decoded.locationId;
            } catch { /* ignore */ }
        }
        return this.voucherService.validateVoucher(body.code, locationId, body.customerId);
    }

    @Put('vouchers/:id/void')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('pos.voucher.void')
    @ApiOperation({ summary: 'Void a voucher' })
    async voidVoucher(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: any) {
        return this.voucherService.voidVoucher(id, body.reason, {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  MERCHANT / BANK COMMISSION CONFIGS
    // ══════════════════════════════════════════════════════════════

    @Get('merchants')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.merchant.read'))
    @ApiOperation({ summary: 'List all merchant configs' })
    async listMerchants(
        @Query('locationId') locationId?: string,
        @Query('bankName') bankName?: string,
        @Query('isActive') isActive?: string,
    ) {
        const filters: any = {};
        if (locationId) filters.locationId = locationId;
        if (bankName) filters.bankName = bankName;
        if (isActive !== undefined) filters.isActive = isActive === 'true';
        return this.merchantService.listMerchants(filters);
    }

    @Get('merchants/for-location')
    @ApiOperation({ summary: 'Get active merchants for a location (POS checkout)' })
    async getMerchantsForLocation(@Req() req: any, @Query('locationId') locationIdParam?: string) {
        let locationId = locationIdParam || '';
        const posTerminalToken = req.cookies?.['posTerminalToken'];
        if (posTerminalToken) {
            try {
                const jwt = require('jsonwebtoken');
                const decoded: any = jwt.decode(posTerminalToken);
                if (decoded?.locationId) locationId = decoded.locationId;
            } catch { /* ignore */ }
        }
        return this.merchantService.getMerchantsForLocation(locationId);
    }

    @Get('merchants/:id')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.merchant.read'))
    @ApiOperation({ summary: 'Get a merchant config by ID' })
    async getMerchant(@Param('id') id: string) {
        return this.merchantService.getMerchantById(id);
    }

    @Post('merchants')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.merchant.create'))
    @ApiOperation({ summary: 'Create a merchant config' })
    async createMerchant(@Body() body: any, @Req() req: any) {
        return this.merchantService.createMerchant(body, {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }

    @Put('merchants/:id')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.merchant.update'))
    @ApiOperation({ summary: 'Update a merchant config' })
    async updateMerchant(@Param('id') id: string, @Body() body: any, @Req() req: any) {
        return this.merchantService.updateMerchant(id, body, {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }

    @Delete('merchants/:id')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.merchant.delete'))
    @ApiOperation({ summary: 'Delete a merchant config' })
    async deleteMerchant(@Param('id') id: string, @Req() req: any) {
        return this.merchantService.deleteMerchant(id, {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }

    @Post('merchants/bulk')
    @UseGuards(JwtAuthGuard, PermissionGuard('master.merchant.create'))
    @ApiOperation({ summary: 'Bulk upsert merchant configs (seed / import)' })
    async bulkUpsertMerchants(@Body() body: { records: any[] }, @Req() req: any) {
        return this.merchantService.bulkUpsert(body.records, {
            userId: req.user?.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }
}
