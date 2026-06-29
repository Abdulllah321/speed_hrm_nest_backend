import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { VoucherExportService } from './voucher-export.service';

// ─────────────────────────────────────────────────────────────────────────────
// Journal Voucher Export
// ─────────────────────────────────────────────────────────────────────────────
@ApiTags('Journal Voucher Export')
@Controller('api/finance/journal-vouchers/export')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class JournalVoucherExportController {
  constructor(private readonly exportService: VoucherExportService) {}

  @Post()
  @Permissions('erp.finance.journal-voucher.read')
  @ApiOperation({ summary: 'Queue a journal voucher export job (returns immediately, notifies when done)' })
  async queueExport(
    @Req() req: any,
    @Query('status')   status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo')   dateTo?: string,
  ) {
    const result = await this.exportService.queueJvExport({
      userId: req.user?.userId,
      status,
      dateFrom,
      dateTo,
    });
    return {
      status: true,
      message: "Export queued. You'll receive a notification when your file is ready.",
      data: result,
    };
  }

  @Get(':jobId/status')
  @Permissions('erp.finance.journal-voucher.read')
  @ApiOperation({ summary: 'Check journal voucher export job status' })
  async getStatus(@Param('jobId') jobId: string) {
    const result = await this.exportService.getJvJobStatus(jobId);
    return { status: true, data: result };
  }

  @Get(':jobId/download')
  @Permissions('erp.finance.journal-voucher.read')
  @ApiOperation({ summary: 'Download a completed journal voucher export file' })
  async download(@Param('jobId') jobId: string, @Res() res: any) {
    try {
      const timestamp = new Date().toISOString().slice(0, 10);
      await this.exportService.streamExportFile(
        jobId,
        `journal-vouchers-export-${timestamp}.xlsx`,
        res,
      );
    } catch (err: any) {
      const status = err?.status ?? 404;
      res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Payment Voucher Export
// ─────────────────────────────────────────────────────────────────────────────
@ApiTags('Payment Voucher Export')
@Controller('api/finance/payment-vouchers/export')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class PaymentVoucherExportController {
  constructor(private readonly exportService: VoucherExportService) {}

  @Post()
  @Permissions('erp.finance.payment-voucher.read')
  @ApiOperation({ summary: 'Queue a payment voucher export job (returns immediately, notifies when done)' })
  async queueExport(
    @Req() req: any,
    @Query('type')     type?: string,
    @Query('status')   status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo')   dateTo?: string,
  ) {
    const result = await this.exportService.queuePvExport({
      userId: req.user?.userId,
      type,
      status,
      dateFrom,
      dateTo,
    });
    return {
      status: true,
      message: "Export queued. You'll receive a notification when your file is ready.",
      data: result,
    };
  }

  @Get(':jobId/status')
  @Permissions('erp.finance.payment-voucher.read')
  @ApiOperation({ summary: 'Check payment voucher export job status' })
  async getStatus(@Param('jobId') jobId: string) {
    const result = await this.exportService.getPvJobStatus(jobId);
    return { status: true, data: result };
  }

  @Get(':jobId/download')
  @Permissions('erp.finance.payment-voucher.read')
  @ApiOperation({ summary: 'Download a completed payment voucher export file' })
  async download(@Param('jobId') jobId: string, @Res() res: any) {
    try {
      const timestamp = new Date().toISOString().slice(0, 10);
      await this.exportService.streamExportFile(
        jobId,
        `payment-vouchers-export-${timestamp}.xlsx`,
        res,
      );
    } catch (err: any) {
      const status = err?.status ?? 404;
      res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Receipt Voucher Export
// ─────────────────────────────────────────────────────────────────────────────
@ApiTags('Receipt Voucher Export')
@Controller('api/finance/receipt-vouchers/export')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ReceiptVoucherExportController {
  constructor(private readonly exportService: VoucherExportService) {}

  @Post()
  @Permissions('erp.finance.receipt-voucher.read')
  @ApiOperation({ summary: 'Queue a receipt voucher export job (returns immediately, notifies when done)' })
  async queueExport(
    @Req() req: any,
    @Query('type')     type?: string,
    @Query('status')   status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo')   dateTo?: string,
  ) {
    const result = await this.exportService.queueRvExport({
      userId: req.user?.userId,
      type,
      status,
      dateFrom,
      dateTo,
    });
    return {
      status: true,
      message: "Export queued. You'll receive a notification when your file is ready.",
      data: result,
    };
  }

  @Get(':jobId/status')
  @Permissions('erp.finance.receipt-voucher.read')
  @ApiOperation({ summary: 'Check receipt voucher export job status' })
  async getStatus(@Param('jobId') jobId: string) {
    const result = await this.exportService.getRvJobStatus(jobId);
    return { status: true, data: result };
  }

  @Get(':jobId/download')
  @Permissions('erp.finance.receipt-voucher.read')
  @ApiOperation({ summary: 'Download a completed receipt voucher export file' })
  async download(@Param('jobId') jobId: string, @Res() res: any) {
    try {
      const timestamp = new Date().toISOString().slice(0, 10);
      await this.exportService.streamExportFile(
        jobId,
        `receipt-vouchers-export-${timestamp}.xlsx`,
        res,
      );
    } catch (err: any) {
      const status = err?.status ?? 404;
      res.status(status).send({ status: false, message: err?.message ?? 'Export file not found' });
    }
  }
}
