import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SalesInvoiceExportService {
  constructor(
    @InjectQueue('sales-invoice-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async queueExportJob(userId: string, invoiceIds?: string[]) {
    const tenantId = this.prisma.getTenantId();
    const tenantDbUrl = this.prisma.getTenantDbUrl();

    const job = await this.exportQueue.add('export-sales-invoices', {
      userId,
      tenantId,
      tenantDbUrl,
      invoiceIds,
    });

    return { jobId: job.id, message: 'Export job queued successfully' };
  }
}
