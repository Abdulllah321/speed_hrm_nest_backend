import { Controller, Get, Post, Body, Param, Res, UseGuards, Request, Sse, MessageEvent } from '@nestjs/common';
import { Response } from 'express';
import { Observable, interval } from 'rxjs';
import { switchMap, takeWhile } from 'rxjs/operators';
import * as fs from 'fs';
import * as path from 'path';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WholesaleInvoiceRegisterService } from '../services/wholesale-invoice-register.service';

@Controller('api/sales/reports/wholesale-invoice-register')
@UseGuards(JwtAuthGuard)
export class WholesaleInvoiceRegisterController {
  constructor(private readonly wholesaleInvoiceRegisterService: WholesaleInvoiceRegisterService) {}

  @Post('queue')
  async queueReportPreview(
    @Request() req,
    @Body() body: {
      customerId?: string;
      startDate?: string;
      endDate?: string;
      reportType?: 'merged' | 'separate';
      search?: string;
      fiscalYear?: string;
      year?: string | number;
    },
  ) {
    const result = await this.wholesaleInvoiceRegisterService.queueReportPreview({
      userId: req.user.userId,
      ...body,
    });
    return { status: true, data: result };
  }

  @Get('result/:jobId')
  async getReportPreviewResult(@Param('jobId') jobId: string) {
    const result = await this.wholesaleInvoiceRegisterService.getReportPreviewResult(jobId);
    if (result) {
      return { status: true, data: result };
    }
    return { status: false, message: 'Preview not ready or expired' };
  }

  @Sse('stream/:jobId')
  streamWholesaleInvoiceRegisterStatus(
    @Param('jobId') jobId: string,
  ): Observable<MessageEvent> {
    return interval(1500).pipe(
      switchMap(async () => {
        const queueStatus = await this.wholesaleInvoiceRegisterService.getJobQueueStatus(jobId);
        let sseStatus: 'queued' | 'processing' | 'completed' | 'failed' = 'queued';
        
        if (queueStatus.status === 'completed' || queueStatus.progress === 100) {
          sseStatus = 'completed';
        } else if (queueStatus.status === 'failed') {
          sseStatus = 'failed';
        } else if (queueStatus.status === 'active' || queueStatus.progress > 0) {
          sseStatus = 'processing';
        }

        return {
          data: JSON.stringify({
            status: sseStatus,
            progressPercent: queueStatus.progress,
            message: queueStatus.message || `Processing wholesale invoice register (${queueStatus.progress}%)`,
            queuePosition: queueStatus.queuePosition,
            waitingCount: queueStatus.waitingCount,
            error: queueStatus.failedReason,
          }),
        } as MessageEvent;
      }),
      takeWhile((event) => {
        const parsed = JSON.parse(event.data as string);
        return parsed.status !== 'completed' && parsed.status !== 'failed';
      }, true),
    );
  }

  @Post('export/queue')
  async queueReportExport(
    @Request() req,
    @Body() body: {
      customerId?: string;
      startDate?: string;
      endDate?: string;
      format: 'xlsx' | 'pdf';
      reportType?: 'merged' | 'separate';
      search?: string;
      fiscalYear?: string;
      year?: string | number;
    },
  ) {
    const result = await this.wholesaleInvoiceRegisterService.queueReportExport({
      userId: req.user.userId,
      ...body,
    });

    return { status: true, data: result };
  }

  @Get('export/:jobId/status')
  async getExportStatus(@Param('jobId') jobId: string) {
    const status = await this.wholesaleInvoiceRegisterService.getJobQueueStatus(jobId);
    return { status: true, data: status };
  }

  @Get('export/:jobId/download/:filename')
  async downloadExport(
    @Param('jobId') jobId: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    // The processor now uploads the file and deletes the local temp file,
    // so we redirect to the global ExportHistory download endpoint which handles URLs and S3.
    return res.redirect(`/api/export-history/${jobId}/download`, 302);
  }

  @Get('stream-preview-excel/:jobId/:filename')
  async streamPreviewExcel(
    @Param('jobId') jobId: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    // Currently relying on client side exports for smaller datasets or full export via background job
    // This is a stub if we wanted to implement fast streaming in the future.
    res.status(404).send('Streaming Excel not yet supported on this route. Use export background job.');
  }
}
