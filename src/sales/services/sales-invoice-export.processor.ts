import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';

@Processor('sales-invoice-export')
export class SalesInvoiceExportProcessor {
  private readonly logger = new Logger(SalesInvoiceExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
  ) {}

  @Process('export-sales-invoices')
  async handleExport(job: Job) {
    const { userId, tenantId, tenantDbUrl } = job.data;
    this.logger.log(`Starting sales invoice export job ${job.id}`);

    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    const fileName = `export-${job.id}.xlsx`;
    const filePath = path.join(exportDir, fileName);

    // Provide tenant credentials to PrismaService for this background context
    const prismaContext = new PrismaService({ tenantId, tenantDbUrl } as any);

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: filePath,
      useStyles: true,
      useSharedStrings: true,
    });

    const sheet = workbook.addWorksheet('Sales Invoices');

    const headers = [
      { header: 'sale invoice Number', key: 'invoiceNo', width: 20 },
      { header: 'DocumentDate', key: 'documentDate', width: 15 },
      { header: 'Type', key: 'type', width: 15 },
      { header: 'SUB Type', key: 'subType', width: 15 },
      { header: 'CNICNumber', key: 'cnic', width: 15 },
      { header: 'T Year', key: 'tYear', width: 10 },
      { header: 'T Month', key: 'tMonth', width: 10 },
      { header: 'T Day', key: 'tDay', width: 10 },
      { header: 'Concept', key: 'concept', width: 20 },
      { header: 'ProductCategory', key: 'productCategory', width: 20 },
      { header: 'Gender', key: 'gender', width: 15 },
      { header: 'Silhouette', key: 'silhouette', width: 20 },
      { header: 'Season', key: 'season', width: 15 },
      { header: 'OldSeason', key: 'oldSeason', width: 15 },
      { header: 'Division', key: 'division', width: 20 },
      { header: 'Department', key: 'department', width: 20 },
      { header: 'Class', key: 'class', width: 15 },
      { header: 'Subclass', key: 'subclass', width: 15 },
      { header: 'Heel Height', key: 'heelHeight', width: 15 },
      { header: 'SKU', key: 'sku', width: 25 },
      { header: 'BarCode', key: 'barCode', width: 25 },
      { header: 'Item Name', key: 'itemName', width: 35 },
      { header: 'Color', key: 'color', width: 15 },
      { header: 'Size', key: 'size', width: 10 },
      { header: 'Width', key: 'width', width: 10 },
      { header: 'HSCode', key: 'hsCode', width: 15 },
      { header: 'Case', key: 'case', width: 10 },
      { header: 'Band', key: 'band', width: 10 },
      { header: 'Movement Type', key: 'movementType', width: 15 },
      { header: 'Quantity', key: 'quantity', width: 10 },
      { header: 'UnitPrice', key: 'unitPrice', width: 15 },
      { header: 'Price_W_O_T', key: 'priceWot', width: 15 },
      { header: 'Total_Price_W_O_T', key: 'totalPriceWot', width: 15 },
      { header: 'DiscountAmount', key: 'discountAmount', width: 15 },
      { header: 'Value Ex Sales Tax', key: 'valueExSalesTax', width: 20 },
      { header: 'Sales Tax', key: 'salesTax', width: 15 },
      { header: 'Additional Sales Tax', key: 'addSalesTax', width: 20 },
      { header: 'Total Sales Tax', key: 'totalSalesTax', width: 15 },
      { header: 'Value Incl Sales Tax', key: 'valueInclSalesTax', width: 20 },
      { header: 'FromDate', key: 'fromDate', width: 15 },
      { header: 'ToDate', key: 'toDate', width: 15 },
      { header: 'UserName', key: 'userName', width: 20 },
      { header: 'Year', key: 'year', width: 10 },
      { header: 'Month', key: 'month', width: 10 },
      { header: 'CompanyName', key: 'companyName', width: 25 },
      { header: 'CompanyAddress', key: 'companyAddress', width: 35 },
      { header: 'CompanyPhone', key: 'companyPhone', width: 15 },
      { header: 'CostCentre', key: 'costCentre', width: 20 },
      { header: 'POS ID', key: 'posId', width: 15 },
      { header: 'FBR Invoice#', key: 'fbrInvoiceNo', width: 20 },
      { header: 'FKExchangeVoucherNumber', key: 'fkExchangeVoucher', width: 20 },
      { header: 'Selling Price', key: 'sellingPrice', width: 15 },
      { header: 'Price WOST', key: 'priceWost', width: 15 },
      { header: 'Sales Tax %', key: 'salesTaxPct', width: 15 },
      { header: 'Additional Sales Tax %', key: 'addSalesTaxPct', width: 20 },
      { header: 'Total Price WOST', key: 'totalPriceWost', width: 20 },
      { header: 'Total Discount', key: 'totalDiscount', width: 15 },
      { header: 'Value Excluding Sales Tax', key: 'valueExcludingSalesTax', width: 20 },
      { header: 'Sales Tax Value', key: 'salesTaxValue', width: 15 },
      { header: 'Additional Sales Tax Value', key: 'addSalesTaxValue', width: 20 },
      { header: 'Value Inculding Sales Tax', key: 'valueIncludingSalesTax', width: 20 },
      { header: 'FKConceptID', key: 'fkConceptId', width: 15 },
      { header: 'Delivery Challan Number', key: 'dcNo', width: 20 },
      { header: 'Sale Order Number', key: 'soNo', width: 20 },
      { header: 'PurchaseOrderNumber', key: 'poNo', width: 20 },
      { header: 'PurchaseOrderDate', key: 'poDate', width: 15 },
      { header: 'TaxRate1', key: 'taxRate1', width: 10 },
      { header: 'TaxRate2', key: 'taxRate2', width: 10 },
      { header: 'Client_Type', key: 'clientType', width: 20 },
      { header: 'Client_Name', key: 'clientName', width: 30 },
      { header: 'Client_GeneralSalesTaxNumber', key: 'clientGst', width: 25 },
    ];

    sheet.columns = headers;

    const formatExcelDate = (date: Date) => {
      if (!date) return '';
      const epoch = new Date(1899, 11, 30);
      const diff = date.getTime() - epoch.getTime();
      return Math.floor(diff / (1000 * 60 * 60 * 24));
    };

    let hasMore = true;
    let cursor: string | undefined = undefined;
    const batchSize = 500;

    const { invoiceIds } = job.data;
    const whereClause = invoiceIds && invoiceIds.length > 0 ? { id: { in: invoiceIds } } : {};

    try {
      while (hasMore) {
        const invoices = await prismaContext.eRPSalesInvoice.findMany({
          where: whereClause,
          take: batchSize,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          orderBy: { createdAt: 'desc' },
          include: {
            customer: true,
            deliveryChallan: true,
            salesOrder: true,
            items: {
              include: {
                item: {
                  include: {
                    brand: true,
                    category: true,
                    subCategory: true,
                    gender: true,
                    season: true,
                    division: true,
                    itemClass: true,
                    itemSubclass: true,
                    color: true,
                    size: true,
                    hsCode: true,
                    silhouette: true,
                  }
                }
              }
            }
          }
        });

        if (invoices.length === 0) {
          hasMore = false;
          break;
        }

        cursor = invoices[invoices.length - 1].id;

        for (const invoice of invoices) {
          for (const item of invoice.items) {
            const product = item.item;
            if (!product) continue;

            const invoiceDate = invoice.invoiceDate || invoice.createdAt;
            const excelDate = formatExcelDate(invoiceDate);
            const y = invoiceDate.getFullYear();
            const m = invoiceDate.getMonth() + 1;
            const d = invoiceDate.getDate();

            const quantity = Number(item.quantity || 0);
            const unitPrice = Number(item.salePrice || 0);
            const discountAmount = Number(item.discount || 0);
            
            const taxRate = Number(product.taxRate1 || 18);
            const wostUnitPrice = unitPrice / (1 + (taxRate / 100));
            const wostTotal = wostUnitPrice * quantity;
            
            const taxableAmt = Math.max(0, wostTotal - discountAmount);
            const valueExclTax = taxableAmt;
            const salesTax = (taxableAmt * taxRate) / 100;
            const valueInclTax = valueExclTax + salesTax;
            const discountPct = quantity > 0 && unitPrice > 0 ? (discountAmount / (unitPrice * quantity)) * 100 : 0;

            const rowData = {
              invoiceNo: invoice.invoiceNo,
              documentDate: excelDate,
              type: 'Wholesale',
              subType: 'Sale',
              cnic: invoice.customer?.cnic || '',
              tYear: y,
              tMonth: m,
              tDay: d,
              concept: product.brand?.name || product.category?.name || 'N/A',
              productCategory: product.subCategory?.name || 'N/A',
              gender: product.gender?.name || 'UNISEX',
              silhouette: product.category?.name || 'N/A',
              season: product.season?.name || 'N/A',
              oldSeason: product.oldSeason || 'N/A',
              division: product.division?.name || 'N/A',
              department: 'N/A',
              class: product.itemClass?.name || 'N/A',
              subclass: product.itemSubclass?.name || 'N/A',
              heelHeight: product.heelHeight || 'N/A',
              sku: product.sku || 'N/A',
              barCode: product.barCode || 'N/A',
              itemName: product.description || 'N/A',
              color: product.color?.name || 'N/A',
              size: product.size?.name || product.size?.code || 'N/A',
              width: product.width || 'N/A',
              hsCode: product.hsCodeStr || product.hsCode?.code || 'N/A',
              case: product.case || 'N/A',
              band: product.band || 'N/A',
              movementType: product.movementType || 'N/A',
              quantity: quantity,
              unitPrice: unitPrice,
              priceWot: Number(wostUnitPrice.toFixed(2)),
              totalPriceWot: Number(wostTotal.toFixed(2)),
              discountAmount: Number(discountAmount.toFixed(2)),
              valueExSalesTax: Number(valueExclTax.toFixed(2)),
              salesTax: Number(salesTax.toFixed(2)),
              addSalesTax: 0,
              totalSalesTax: Number(salesTax.toFixed(2)),
              valueInclSalesTax: Number(valueInclTax.toFixed(2)),
              fromDate: excelDate,
              toDate: excelDate,
              userName: invoice.createdBy || 'System',
              year: y,
              month: m,
              companyName: 'Speed Pvt. Ltd.',
              companyAddress: 'Office No. 01 | 1st Floor | Services Club Extension Building | Merewether Road | Karachi - 75520 | Pakistan. Tel +922135652161 | Fax +922135652166',
              companyPhone: 'N/A',
              costCentre: 'Speed Pvt. Ltd.',
              posId: 'N/A',
              fbrInvoiceNo: '',
              fkExchangeVoucher: 0,
              sellingPrice: unitPrice,
              priceWost: Number(wostUnitPrice.toFixed(2)),
              salesTaxPct: taxRate,
              addSalesTaxPct: 0,
              totalPriceWost: Number(wostTotal.toFixed(2)),
              totalDiscount: Number(discountAmount.toFixed(2)),
              valueExcludingSalesTax: Number(valueExclTax.toFixed(2)),
              salesTaxValue: Number(salesTax.toFixed(2)),
              addSalesTaxValue: 0,
              valueIncludingSalesTax: Number(valueInclTax.toFixed(2)),
              fkConceptId: 1,
              dcNo: invoice.deliveryChallan?.challanNo || '',
              soNo: invoice.salesOrder?.orderNo || '',
              poNo: '',
              poDate: '',
              taxRate1: taxRate,
              taxRate2: 0,
              clientType: invoice.customer?.clientType || 'N/A',
              clientName: invoice.customer?.name || 'N/A',
              clientGst: invoice.customer?.gstNo || invoice.customer?.strn || 'N/A',
            };

            const row = sheet.addRow(rowData);
            row.commit();
          }
        }
      }

      sheet.commit();
      await workbook.commit();

      this.logger.log(`Export completed for job ${job.id}`);

      // Send notification
      await this.notificationsService.create({
        userId,
        title: 'Export Ready',
        message: 'Your sales invoice export is ready for download.',
        category: 'export',
        priority: 'high',
        actionType: 'sales-invoice-export.ready',
        actionPayload: JSON.stringify({ jobId: job.id.toString() }),
        entityType: 'sales-invoice-export',
        entityId: job.id.toString(),
      });

    } catch (error: any) {
      this.logger.error(`Failed to export sales invoices: ${error.message}`);
      throw error;
    }
  }
}
