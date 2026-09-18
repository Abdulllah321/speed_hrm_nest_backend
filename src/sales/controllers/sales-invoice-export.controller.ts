import { Controller, Post, Get, Param, Res, UseGuards, Req, Logger, Body } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SalesInvoiceExportService } from '../services/sales-invoice-export.service';
import * as fs from 'fs';
import * as path from 'path';

@UseGuards(JwtAuthGuard)
@Controller('api/sales-invoices/export')
export class SalesInvoiceExportController {
  private readonly logger = new Logger(SalesInvoiceExportController.name);

  constructor(private readonly exportService: SalesInvoiceExportService) {}

  @Post()
  async queueExport(@Req() req: any, @Body() body: { invoiceIds?: string[] }) {
    return this.exportService.queueExportJob(req.user.id, body.invoiceIds);
  }

  @Post('sync')
  async syncExport(@Req() req: any, @Body() body: { invoiceIds?: string[] }, @Res() res: Response) {
    try {
      res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.header('Content-Disposition', `attachment; filename="sales-invoices-export.xlsx"`);
      await this.exportService.streamExportFile(res, body.invoiceIds);
    } catch (error: any) {
      this.logger.error(`Error streaming export: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).send({ message: 'Internal server error during export generation' });
      }
    }
  }

  @Get('download/:jobId')
  async downloadExport(@Param('jobId') jobId: string, @Res() res: any) {
    try {
      const fileName = `export-${jobId}.xlsx`;
      const filePath = path.join(process.cwd(), 'uploads', 'exports', fileName);

      if (!fs.existsSync(filePath)) {
        res.status(404).send({ message: 'Export file not found or expired' });
        return;
      }

      const stat = fs.statSync(filePath);
      const fileStream = fs.createReadStream(filePath);
      
      res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.header('Content-Disposition', `attachment; filename="sales-invoices-export.xlsx"`);
      res.header('Content-Length', stat.size);
      
      fileStream.on('end', () => {
        fs.unlink(filePath, (err) => {
          if (err) this.logger.error(`Error deleting export file: ${err.message}`);
        });
      });

      fileStream.on('error', (err) => {
        this.logger.error(`Stream error: ${err.message}`);
        if (!res.sent) {
          res.status(500).send({ message: 'Error streaming file' });
        }
      });

      res.send(fileStream);
    } catch (error: any) {
      this.logger.error(`Download error: ${error.message}`);
      if (!res.sent) {
        res.status(500).send({ message: 'Internal server error during download' });
      }
    }
  }
}
