import {
    Controller,
    Post,
    Get,
    Delete,
    Param,
    UseGuards,
    HttpStatus,
    BadRequestException,
    Req,
    Res,
    Sse,
    MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import * as jwt from 'jsonwebtoken';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OnlineOrderManagementService } from './online-order-management.service';

@ApiTags('Online Order Management')
@Controller('api/pos-sales/online-orders/bulk-upload')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class OnlineOrderManagementController {
    constructor(private readonly service: OnlineOrderManagementService) {}

    @Get()
    @ApiOperation({ summary: 'Get list of online orders grouped by order ID' })
    async getOrders() {
        return this.service.getGroupedOrders();
    }

    @Post()
    @ApiOperation({ summary: 'Upload online orders file for validation' })
    async uploadFile(@Req() req: any) {
        const file = await req.file();
        if (!file) throw new BadRequestException('No file uploaded');

        const allowedExtensions = ['csv', 'xlsx', 'xls'];
        const ext = file.filename.split('.').pop()?.toLowerCase();
        if (!ext || !allowedExtensions.includes(ext)) {
            throw new BadRequestException(`Invalid file type. Allowed: ${allowedExtensions.join(', ')}`);
        }

        const buffer = await file.toBuffer();
        const result = await this.service.uploadFile(buffer, file.filename);
        
        return { status: true, message: 'File uploaded. Validation started...', data: result };
    }

    @Post(':uploadId/confirm')
    @ApiOperation({ summary: 'Confirm and start import of valid orders' })
    async confirmUpload(@Param('uploadId') uploadId: string) {
        return this.service.confirmUpload(uploadId);
    }

    @Post(':orderNumber/post')
    @ApiOperation({ summary: 'Post an online order to POS Sales' })
    async postOrder(@Param('orderNumber') orderNumber: string, @Req() req: any) {
        let locationId = undefined;
        let posId = undefined;
        let terminalId = undefined;
        
        if (req.cookies?.posTerminalToken) {
            try {
                const decoded: any = jwt.decode(req.cookies.posTerminalToken);
                locationId = decoded?.locationId;
                posId = decoded?.posId;
                terminalId = decoded?.terminalId;
            } catch (e) {}
        }
        if (!locationId) {
            locationId = req.user?.locationId;
        }
        if (!locationId) {
            throw new BadRequestException('Location context is required to post order');
        }
        
        // POS Sales requires a cashier user. We use the current user or terminal operator.
        const cashierUserId = req.user?.id;
        if (!cashierUserId) {
            throw new BadRequestException('Cashier context is required');
        }
        
        return this.service.postOrder(orderNumber, cashierUserId, locationId, req.user, posId, terminalId);
    }

    @Get('template/download')
    @ApiOperation({ summary: 'Download online orders CSV template' })
    async downloadTemplate(@Res() res: any) {
        const template = [
            'Order Number,Order Id,SKU,Barcode,System Sku,Size,Name,Brand,Qty,Price,Paid Price,Sub Total (Paid Price),Sub Total (Price),SKU discounted,SKU actual discount,Shipping Charges,Order Total,Item Status,Real Market Status,Coupon Code,Payment Method,Tracking Number,Marketplace,Channel,Ordered At,Order Month,Order Year,Customer Type,Customer Name,Email,City,Phone,Address,Note,Fulfilled By Warehouse,Shipping',
            'ORD-001,1001,SKU-A,123456789,SYS-SKU-A,M,Test Product,TestBrand,1,100,90,90,100,10,10,5,95,Shipped,Completed,DISC10,CC,TRK123,Amazon,Online,2025-01-01,1,2025,New,John Doe,john@example.com,NY,1234567890,123 Main St,Test Note,WH-1,Standard',
        ].join('\n');
        res.header('Content-Type', 'text/csv');
        res.header('Content-Disposition', 'attachment; filename="online-orders-template.csv"');
        return res.status(HttpStatus.OK).send(template);
    }

    @Get(':uploadId/status')
    @ApiOperation({ summary: 'Get upload status' })
    async getUploadStatus(@Param('uploadId') uploadId: string) {
        const result = this.service.getUploadStatus(uploadId);
        return {
            status: true,
            data: {
                uploadId,
                status: result.status,
                progress: result.progress,
                totalRecords: result.totalRecords,
            }
        };
    }

    @Delete(':uploadId')
    @ApiOperation({ summary: 'Cancel upload' })
    async cancelUpload(@Param('uploadId') uploadId: string) {
        this.service.cancelUpload(uploadId);
        return { status: true, message: 'Upload cancelled' };
    }

    @Sse(':uploadId/events')
    @ApiOperation({ summary: 'Stream events (SSE)' })
    streamEvents(@Param('uploadId') uploadId: string): Observable<MessageEvent> {
        return this.service.subscribeToEvents(uploadId);
    }
}
