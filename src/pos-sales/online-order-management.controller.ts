import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Param,
  Query,
  Body,
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

  private extractLocationContext(req: any) {
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

    return { locationId, posId, terminalId };
  }

  @Get()
  @ApiOperation({ summary: 'Get list of online orders grouped by order ID' })
  async getOrders(@Req() req: any) {
    const { locationId } = this.extractLocationContext(req);
    return this.service.getGroupedOrders(locationId);
  }

  @Get('validate-voucher')
  @ApiOperation({ summary: 'Validate voucher or coupon code in real-time' })
  async validateVoucher(@Query('code') code: string, @Req() req: any) {
    if (!code || !code.trim()) {
      throw new BadRequestException('Voucher or coupon code is required.');
    }
    const { locationId } = this.extractLocationContext(req);
    const result = await this.service.resolveVoucherOrCoupon(code, locationId);
    return {
      status: true,
      data: result,
    };
  }

  @Get('resolve-item')
  @ApiOperation({
    summary: 'Resolve product master details and dual inventory stock by barcode or SKU',
  })
  async resolveItem(
    @Query('barcode') barcode: string,
    @Query('term') term: string,
    @Req() req: any,
  ) {
    const query = barcode || term;
    if (!query || !query.trim()) {
      throw new BadRequestException('Barcode or SKU is required.');
    }
    const { locationId } = this.extractLocationContext(req);
    return this.service.resolveItemDetails(query, locationId);
  }

  @Post()
  @ApiOperation({ summary: 'Upload online orders file for validation' })
  async uploadFile(@Req() req: any) {
    const file = await req.file();
    if (!file) throw new BadRequestException('No file uploaded');

    const allowedExtensions = ['csv', 'xlsx', 'xls'];
    const ext = file.filename.split('.').pop()?.toLowerCase();
    if (!ext || !allowedExtensions.includes(ext)) {
      throw new BadRequestException(
        `Invalid file type. Allowed: ${allowedExtensions.join(', ')}`,
      );
    }

    const { locationId } = this.extractLocationContext(req);
    const buffer = await file.toBuffer();
    const result = await this.service.uploadFile(buffer, file.filename, locationId);

    return {
      status: true,
      message: 'File uploaded. Validation started...',
      data: result,
    };
  }

  @Post(':uploadId/confirm')
  @ApiOperation({ summary: 'Confirm and start import of valid orders' })
  async confirmUpload(@Param('uploadId') uploadId: string, @Req() req: any) {
    const { locationId } = this.extractLocationContext(req);
    if (!locationId) {
      throw new BadRequestException(
        'Location context is required to upload orders',
      );
    }

    return this.service.confirmUpload(uploadId, locationId);
  }

  @Post('bulk-post')
  @ApiOperation({ summary: 'Bulk post selected online orders to POS Sales' })
  async bulkPostOrders(
    @Body() body: { orderNumbers: string[] },
    @Req() req: any,
  ) {
    if (!body?.orderNumbers || !Array.isArray(body.orderNumbers) || body.orderNumbers.length === 0) {
      throw new BadRequestException('Please provide a list of order numbers to post.');
    }

    const { locationId, posId, terminalId } = this.extractLocationContext(req);
    if (!locationId) {
      throw new BadRequestException('Location context is required to post orders.');
    }

    const cashierUserId = req.user?.id;
    if (!cashierUserId) {
      throw new BadRequestException('Cashier context is required.');
    }

    const result = await this.service.bulkPostOrders(
      body.orderNumbers,
      cashierUserId,
      locationId,
      req.user,
      posId,
      terminalId,
    );

    return {
      status: true,
      message: `Processed ${result.total} orders (${result.successCount} posted, ${result.failedCount} failed)`,
      data: result.data || result,
      summary: result.summary,
      total: result.total,
      successCount: result.successCount,
      failedCount: result.failedCount,
      results: result.results,
    };
  }

  @Post(':orderNumber/post')
  @ApiOperation({ summary: 'Post an online order to POS Sales' })
  async postOrder(@Param('orderNumber') orderNumber: string, @Req() req: any) {
    const { locationId, posId, terminalId } = this.extractLocationContext(req);
    if (!locationId) {
      throw new BadRequestException(
        'Location context is required to post order',
      );
    }

    const cashierUserId = req.user?.id;
    if (!cashierUserId) {
      throw new BadRequestException('Cashier context is required');
    }

    return this.service.postOrder(
      orderNumber,
      cashierUserId,
      locationId,
      req.user,
      posId,
      terminalId,
    );
  }

  @Get('order/:orderNumber')
  @ApiOperation({ summary: 'Get details of a single online order' })
  async getOrderDetails(
    @Param('orderNumber') orderNumber: string,
    @Req() req: any,
  ) {
    const { locationId } = this.extractLocationContext(req);
    return this.service.getOrderDetails(orderNumber, locationId);
  }

  @Put('order/:orderNumber')
  @ApiOperation({
    summary: 'Update an unposted online order (voucher, customer info, items, pricing, shipping)',
  })
  async updateOrder(
    @Param('orderNumber') orderNumber: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const { locationId } = this.extractLocationContext(req);
    return this.service.updateOrder(orderNumber, body, locationId);
  }

  @Delete('order/:orderNumber')
  @ApiOperation({ summary: 'Delete an unposted online order' })
  async deleteOrder(@Param('orderNumber') orderNumber: string) {
    return this.service.deleteOrder(orderNumber);
  }

  @Put('order/:orderNumber/confirmation')
  @ApiOperation({ summary: 'Update customer confirmation status and notes' })
  async updateConfirmationStatus(
    @Param('orderNumber') orderNumber: string,
    @Body() body: { confirmationStatus: string; notes?: string },
    @Req() req: any,
  ) {
    const cashier = req.user?.username || req.user?.email || 'User';
    return this.service.updateConfirmationStatus(orderNumber, {
      ...body,
      confirmedBy: cashier,
    });
  }

  @Post('bulk-confirm')
  @ApiOperation({ summary: 'Bulk update customer confirmation status for multiple orders' })
  async bulkUpdateConfirmationStatus(
    @Body() body: { orderNumbers: string[]; confirmationStatus: string; notes?: string },
    @Req() req: any,
  ) {
    const cashier = req.user?.username || req.user?.email || 'User';
    return this.service.bulkUpdateConfirmationStatus(body.orderNumbers, {
      confirmationStatus: body.confirmationStatus,
      notes: body.notes,
      confirmedBy: cashier,
    });
  }

  @Get('barcode-stock/:identifier')
  @ApiOperation({ summary: 'Get multi-location real-time stock for an item or barcode' })
  async getBarcodeStock(@Param('identifier') identifier: string) {
    return this.service.getMultiLocationStock(identifier);
  }

  @Post('batch-barcode-stock')
  @ApiOperation({ summary: 'Batch get multi-location stock for multiple items/barcodes' })
  async getBatchBarcodeStock(@Body() body: { identifiers: string[] }) {
    return this.service.getBatchMultiLocationStock(body.identifiers || []);
  }

  @Get('template/download')
  @ApiOperation({ summary: 'Download online orders CSV template' })
  async downloadTemplate(@Res() res: any) {
    const template = [
      'Order Number,Order Id,SKU,Barcode,System Sku,Size,Name,Brand,Qty,Price,Paid Price,Sub Total (Paid Price),Sub Total (Price),SKU discounted,SKU actual discount,Shipping Charges,Order Total,Item Status,Real Market Status,Coupon Code,Payment Method,Tracking Number,Marketplace,Channel,Ordered At,Order Month,Order Year,Customer Type,Customer Name,Email,City,Phone,Address,Note,Fulfilled By Warehouse,Shipping',
      'ORD-001,1001,SKU-A,123456789,SYS-SKU-A,M,Test Product,TestBrand,1,100,90,90,100,10,10,5,95,Shipped,Completed,GFT-001,COD,TRK123,Shopify,Online,2025-01-01,1,2025,New,John Doe,john@example.com,Lahore,03001234567,123 Main St,Handle with care,WH-1,Standard',
    ].join('\n');
    res.header('Content-Type', 'text/csv');
    res.header(
      'Content-Disposition',
      'attachment; filename="online-orders-template.csv"',
    );
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
        message: result.message,
        successRecords: result.successRecords,
        failedRecords: result.failedRecords,
        errors: result.errors,
        summary: result.summary,
      },
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
