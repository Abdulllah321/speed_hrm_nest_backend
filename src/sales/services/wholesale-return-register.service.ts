import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as readline from 'readline';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { pipeline } from 'stream';
import { PrismaService } from '../../prisma/prisma.service';

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface WholesaleReturnTotals {
  invoiceCount: number;
  totalItems: number;
  grossAmount: number;
  wostAmount: number;
  discountAmount: number;
  netAmount: number;
  taxAmount: number;
}

export interface WholesaleReturnLineItem {
  id: string;
  sku: string;
  barCode: string;
  description: string;
  categoryName: string;
  brandName: string;
  divisionName: string;
  genderName: string;
  silhouetteName: string;
  sizeName: string;
  colorName: string;
  quantity: number;
  taxRate: number;
  unitPrice: number;
  wostAmount: number;
  discountAmount: number;
  taxAmount: number;
  addTaxAmount: number;
  taxPayable: number;
  subTotal: number;
}

export interface WholesaleReturnProductNode {
  sku: string;
  description: string;
  sellingPrice: number;
  totals: WholesaleReturnTotals;
  items: WholesaleReturnLineItem[];
}

export interface WholesaleReturnCategoryNode {
  categoryName: string;
  brandName: string;
  totals: WholesaleReturnTotals;
  products: WholesaleReturnProductNode[];
}

export interface WholesaleReturnNode {
  returnNumber: string;
  returnDate: string;
  status: string;
  categories: WholesaleReturnCategoryNode[];
  totals: WholesaleReturnTotals;
}

export interface WholesaleReturnCustomerNode {
  customerId: string;
  customerName: string;
  customerPhone: string;
  returns: WholesaleReturnNode[];
  totals: WholesaleReturnTotals;
}

export interface WholesaleReturnFlatRecord {
  customerId: string;
  customerName: string;
  customerPhone: string;
  returnNumber: string;
  returnDate: string;
  status: string;
  categoryName: string;
  brandName: string;
  divisionName: string;
  genderName: string;
  silhouetteName: string;
  sku: string;
  description: string;
  sizeName: string;
  colorName: string;
  taxRate: number;
  quantity: number;
  unitPrice: number;
  wostAmount: number;
  discountAmount: number;
  taxAmount: number;
  addTaxAmount: number;
  taxPayable: number;
  subTotal: number;
}

export interface WholesaleReturnRegisterResult {
  reportType: 'merged' | 'separate';
  customers: WholesaleReturnCustomerNode[];
  flatItems: WholesaleReturnFlatRecord[];
  grandTotals: WholesaleReturnTotals;
  dateRange: { startDate?: string; endDate?: string };
}

@Injectable()
export class WholesaleReturnRegisterService {
  private readonly logger = new Logger(WholesaleReturnRegisterService.name);
  private readonly previewStorageDir = path.join(process.cwd(), 'uploads', 'report-previews');

  constructor(
    @InjectQueue('sales-invoice-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
  ) {
    if (!fs.existsSync(this.previewStorageDir)) {
      fs.mkdirSync(this.previewStorageDir, { recursive: true });
    }
  }

  async queueReportPreview(opts: {
    userId: string;
    customerId?: string;
    startDate?: string;
    endDate?: string;
    reportType?: 'merged' | 'separate';
    search?: string;
    fiscalYear?: string;
    year?: string | number;
  }): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    await this.exportQueue.add(
      'generate-wholesale-return-register-preview',
      {
        jobId,
        userId: opts.userId,
        tenantId,
        tenantDbUrl,
        customerId: opts.customerId,
        startDate: opts.startDate,
        endDate: opts.endDate,
        reportType: opts.reportType || 'merged',
        search: opts.search,
        fiscalYear: opts.fiscalYear,
        year: opts.year,
      },
      {
        jobId: `preview-wr-${jobId}`,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
        timeout: 60 * 60 * 1000,
      },
    );

    this.logger.log(`[WholesaleReturnRegister] Queued preview job ${jobId} for user ${opts.userId}`);
    return { jobId };
  }

  async getJobQueueStatus(jobId: string): Promise<any> {
    const job = await this.exportQueue.getJob(`preview-wr-${jobId}`) ||
                await this.exportQueue.getJob(jobId);
    if (!job) {
      return { status: 'unknown', state: 'unknown', progress: 0, message: '', queuePosition: 0, waitingCount: 0 };
    }

    const state = await job.getState();
    const progressRaw = job.progress();
    let progress = 0;
    let message = '';

    if (typeof progressRaw === 'number') {
      progress = progressRaw;
    } else if (typeof progressRaw === 'object' && progressRaw !== null) {
      progress = (progressRaw as any).percent || 0;
      message = (progressRaw as any).message || '';
    }

    return {
      status: state,
      state,
      progress,
      message,
      queuePosition: 0,
      waitingCount: 0,
      failedReason: job.failedReason,
    };
  }

  getPreviewNdjsonFilePath(jobId: string): string {
    return path.join(this.previewStorageDir, `wr-preview-${jobId}.ndjson.gz`);
  }

  async saveReportPreviewResult(jobId: string, result: any): Promise<void> {
    try {
      const jsonPath = path.join(this.previewStorageDir, `wr-preview-${jobId}.json.gz`);
      const previewResult = {
        ...result,
        flatItems: (result.flatItems || []).slice(0, 5000),
        customers: (result.customers || []).slice(0, 5000),
      };
      const jsonStr = JSON.stringify(previewResult);
      const compressedJson = await gzipAsync(Buffer.from(jsonStr, 'utf8'));
      await fs.promises.writeFile(jsonPath, compressedJson);
    } catch (err: any) {
      this.logger.warn(`Failed to save compressed preview JSON for ${jobId}: ${err.message}`);
    }

    const filePath = this.getPreviewNdjsonFilePath(jobId);
    const gzip = zlib.createGzip({ level: 6 });
    const writeStream = fs.createWriteStream(filePath);

    await new Promise<void>((resolve, reject) => {
      pipeline(gzip, writeStream, (err) => {
        if (err) reject(err);
        else resolve();
      });

      const writeData = async () => {
        try {
          const safeWrite = async (chunk: string): Promise<void> => {
            if (!gzip.write(chunk)) {
              await new Promise((r) => gzip.once('drain', r));
            }
          };

          const metaLine = JSON.stringify({
            type: 'meta',
            reportType: result.reportType,
            dateRange: result.dateRange,
            totalRecords: (result.flatItems || []).length,
          }) + '\n';
          await safeWrite(metaLine);

          const CHUNK = 100;
          const customers = result.customers || [];
          for (let i = 0; i < customers.length; i += CHUNK) {
            const slice = customers.slice(i, i + CHUNK);
            const chunkLine = JSON.stringify({
              type: 'customers',
              startIndex: i,
              count: slice.length,
              customers: slice,
            }) + '\n';
            await safeWrite(chunkLine);
            await new Promise((res) => setImmediate(res));
          }

          const flatItems = result.flatItems || [];
          for (let i = 0; i < flatItems.length; i += 1500) {
            const slice = flatItems.slice(i, i + 1500);
            const chunkLine = JSON.stringify({
              type: 'flatItems',
              startIndex: i,
              count: slice.length,
              flatItems: slice,
            }) + '\n';
            await safeWrite(chunkLine);
            await new Promise((res) => setImmediate(res));
          }

          const totalsLine = JSON.stringify({
            type: 'totals',
            grandTotals: result.grandTotals,
            totalRecords: flatItems.length,
            done: true,
          }) + '\n';
          await safeWrite(totalsLine);

          gzip.end();
        } catch (e) {
          gzip.destroy(e as any);
        }
      };

      writeData();
    });
  }

  async getReportPreviewResult(jobId: string): Promise<any | null> {
    const jsonPath = path.join(this.previewStorageDir, `wr-preview-${jobId}.json.gz`);
    if (fs.existsSync(jsonPath)) {
      const compressed = await fs.promises.readFile(jsonPath);
      const decompressed = await gunzipAsync(compressed);
      const parsed = JSON.parse(decompressed.toString('utf8'));
      return parsed.data || parsed;
    }

    const ndjsonPath = path.join(this.previewStorageDir, `wr-preview-${jobId}.ndjson.gz`);
    if (!fs.existsSync(ndjsonPath)) {
      return null;
    }

    return new Promise<any | null>((resolve) => {
      const gz = fs.createReadStream(ndjsonPath);
      const gunzip = zlib.createGunzip();
      const rl = readline.createInterface({ input: gz.pipe(gunzip) });

      let meta: any = {};
      const customers: any[] = [];
      const flatItems: any[] = [];
      let grandTotals: any = {};
      const PREVIEW_LIMIT = 5000;

      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          if (line.includes('"type":"meta"')) {
            meta = JSON.parse(line);
          } else if (line.includes('"type":"totals"')) {
            grandTotals = JSON.parse(line).grandTotals || {};
          } else if (line.includes('"type":"customers"')) {
            const obj = JSON.parse(line);
            if (Array.isArray(obj.customers)) {
              customers.push(...obj.customers);
            }
          } else if (line.includes('"type":"flatItems"')) {
            if (flatItems.length < PREVIEW_LIMIT) {
              const obj = JSON.parse(line);
              if (Array.isArray(obj.flatItems)) {
                const remaining = PREVIEW_LIMIT - flatItems.length;
                flatItems.push(...obj.flatItems.slice(0, remaining));
              }
            }
          }
        } catch {}
      });

      rl.on('close', () => {
        resolve({
          reportType: meta.reportType || 'merged',
          dateRange: meta.dateRange || {},
          customers: customers.length > 0 ? customers : undefined,
          flatItems,
          grandTotals,
        });
      });

      gz.on('error', () => resolve(null));
      gunzip.on('error', () => resolve(null));
    });
  }

  async generateWholesaleReturnRegisterDataInternal(
    prisma: PrismaService,
    opts: {
      customerId?: string;
      startDate?: string;
      endDate?: string;
      reportType?: 'merged' | 'separate';
      search?: string;
      fiscalYear?: string;
      year?: string | number;
      onProgress?: (percent: number, message: string) => Promise<void> | void;
    },
  ): Promise<WholesaleReturnRegisterResult> {
    const {
      customerId,
      startDate: startStr,
      endDate: endStr,
      reportType = 'merged',
      search,
      fiscalYear,
      year,
      onProgress,
    } = opts;

    const now = new Date();

    const parseLocalDate = (dateStr: string | undefined, isEndOfDay = false): Date => {
      if (!dateStr) {
        if (isEndOfDay) {
          const d = new Date(now);
          d.setHours(23, 59, 59, 999);
          return d;
        } else {
          return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        }
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [y, m, d] = dateStr.split('-').map(Number);
        return isEndOfDay
          ? new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999))
          : new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
      }
      if (dateStr.includes('T') || dateStr.includes('Z')) {
        const d = new Date(dateStr);
        if (isEndOfDay && !dateStr.includes('T23:59:59')) {
          d.setHours(23, 59, 59, 999);
        }
        return d;
      }
      const timePart = isEndOfDay ? 'T23:59:59.999' : 'T00:00:00.000';
      return new Date(`${dateStr}${timePart}`);
    };

    const getFiscalYearBounds = (fyStr?: string): { start: Date; end: Date } => {
      let startYear: number;
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      const defaultStartYear = currentMonth >= 6 ? currentYear : currentYear - 1;

      if (!fyStr || fyStr === 'current') {
        startYear = defaultStartYear;
      } else if (fyStr === 'previous') {
        startYear = defaultStartYear - 1;
      } else {
        const match = fyStr.match(/(\d{4})/);
        startYear = match ? parseInt(match[1], 10) : defaultStartYear;
      }

      const start = new Date(Date.UTC(startYear, 6, 1, 0, 0, 0, 0));
      const end = new Date(Date.UTC(startYear + 1, 5, 30, 23, 59, 59, 999));
      return { start, end };
    };

    let startDate: Date;
    let endDate: Date;

    if (fiscalYear) {
      const bounds = getFiscalYearBounds(fiscalYear);
      startDate = bounds.start;
      endDate = bounds.end;
    } else if (year) {
      const yr = typeof year === 'string' ? parseInt(year, 10) : year;
      const targetYear = !isNaN(yr) && yr > 2000 ? yr : now.getFullYear();
      startDate = new Date(Date.UTC(targetYear, 0, 1, 0, 0, 0, 0));
      endDate = new Date(Date.UTC(targetYear, 11, 31, 23, 59, 59, 999));
    } else if (startStr || endStr) {
      startDate = parseLocalDate(startStr, false);
      endDate = parseLocalDate(endStr, true);
    } else {
      const bounds = getFiscalYearBounds('current');
      startDate = bounds.start;
      endDate = bounds.end;
    }

    await onProgress?.(20, 'Querying wholesale returns from database...');

    const returnWhere: any = {
      returnDate: { gte: startDate, lte: endDate },
    };

    if (customerId) {
      returnWhere.customerId = customerId;
    }

    const returns = await prisma.salesReturn.findMany({
      where: returnWhere,
      include: {
        customer: { select: { id: true, name: true, contactNo: true } },
        items: {
          include: {
            salesInvoiceItem: {
              select: { salePrice: true, discount: true, total: true, quantity: true },
            },
            item: {
              include: {
                category: { select: { name: true } },
                brand: { select: { name: true } },
                division: { select: { name: true } },
                gender: { select: { name: true } },
                silhouette: { select: { name: true } },
                size: { select: { name: true } },
                color: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { returnDate: 'desc' },
    });

    await onProgress?.(60, `Formatting ${returns.length} returns...`);

    const createEmptyTotals = (): WholesaleReturnTotals => ({
      invoiceCount: 0,
      totalItems: 0,
      grossAmount: 0,
      wostAmount: 0,
      discountAmount: 0,
      netAmount: 0,
      taxAmount: 0,
    });

    const grandTotals = createEmptyTotals();
    const flatItems: WholesaleReturnFlatRecord[] = [];
    const customerMap = new Map<string, WholesaleReturnCustomerNode>();

    const searchLower = search ? search.toLowerCase() : '';

    const defaultTaxRate = 18;

    for (const ret of returns) {
      if (!ret.items || ret.items.length === 0) continue;

      const custName = ret.customer?.name || 'Unknown';
      const custPhone = ret.customer?.contactNo || '';
      const custId = ret.customer?.id || 'unknown';

      // Setup customer node if not exists
      if (!customerMap.has(custId)) {
        customerMap.set(custId, {
          customerId: custId,
          customerName: custName,
          customerPhone: custPhone,
          returns: [],
          totals: createEmptyTotals(),
        });
      }
      const customerNode = customerMap.get(custId)!;

      const returnNode: WholesaleReturnNode = {
        returnNumber: ret.returnNumber,
        returnDate: ret.returnDate.toISOString(),
        status: ret.status,
        categories: [],
        totals: createEmptyTotals(),
      };
      
      const invoiceCategoriesMap = new Map<string, WholesaleReturnCategoryNode>();
      let invoiceMatchSearch = false;
      let addedAnyItems = false;

      // Check if invoice header matches search
      if (searchLower) {
        if (
          ret.returnNumber.toLowerCase().includes(searchLower) ||
          custName.toLowerCase().includes(searchLower)
        ) {
          invoiceMatchSearch = true;
        }
      } else {
        invoiceMatchSearch = true;
      }

      for (const retItem of ret.items) {
        const itemObj = retItem.item;
        if (!itemObj) continue;

        const catName = itemObj.category?.name || 'GENERAL';
        const brandName = itemObj.brand?.name || 'YOUNG ATHLETES';
        const sku = itemObj.sku || 'N/A';
        const description = itemObj.description || 'N/A';

        // Apply search filter on item level
        if (searchLower && !invoiceMatchSearch) {
          if (
            !sku.toLowerCase().includes(searchLower) &&
            !description.toLowerCase().includes(searchLower) &&
            !catName.toLowerCase().includes(searchLower) &&
            !brandName.toLowerCase().includes(searchLower)
          ) {
            continue;
          }
        }

        const qty = Number(retItem.returnQty) || 0;

        // Use original invoice item values if available, else fall back to return item
        const origItem = (retItem as any).salesInvoiceItem;
        const grossSellingPrice = origItem?.salePrice
          ? Number(origItem.salePrice)
          : Number(retItem.unitPrice || 0);

        const itemTaxRate = Number((itemObj as any).taxRate1 ?? defaultTaxRate);

        // Value Excl Tax: back-calculate from selling price (incl tax)
        const wostUnitPrice = grossSellingPrice / (1 + itemTaxRate / 100);
        const valueExclTax = Math.round(wostUnitPrice * qty);

        // Discount: origItem.discount is the TOTAL discount for the full origItem qty
        // We need discount per-unit × return qty
        const origQty = origItem?.quantity || qty;
        const discountPerUnit = origItem?.discount ? Number(origItem.discount) / origQty : 0;
        const discount = Math.round(discountPerUnit * qty);

        const taxableAmt = Math.max(0, valueExclTax - discount);
        const salesTax = Math.round(taxableAmt * (itemTaxRate / 100));
        const addTax = 0;
        const taxPayable = salesTax + addTax;

        // Net value (value incl tax after discount)
        const valueInclTax = origItem?.total !== undefined
          ? Math.round(Number(origItem.total))
          : (taxableAmt + taxPayable);

        const record: WholesaleReturnLineItem = {
          id: retItem.id,
          sku,
          barCode: (itemObj as any).barCode || '',
          description,
          categoryName: catName,
          brandName,
          divisionName: itemObj.division?.name || '',
          genderName: itemObj.gender?.name || '',
          silhouetteName: itemObj.silhouette?.name || '',
          sizeName: itemObj.size?.name || '',
          colorName: itemObj.color?.name || '',
          quantity: qty,
          unitPrice: grossSellingPrice,
          wostAmount: valueExclTax,
          discountAmount: discount,
          taxAmount: salesTax,
          addTaxAmount: addTax,
          taxPayable: taxPayable,
          subTotal: valueInclTax,
          taxRate: itemTaxRate,
        };

        // Flat
        flatItems.push({
          customerId: custId,
          customerName: custName,
          customerPhone: custPhone,
          returnNumber: ret.returnNumber,
          returnDate: ret.returnDate.toISOString(),
          status: ret.status,
          categoryName: record.categoryName,
          brandName: record.brandName,
          divisionName: record.divisionName,
          genderName: record.genderName,
          silhouetteName: record.silhouetteName,
          sku: record.sku,
          description: record.description,
          sizeName: record.sizeName,
          colorName: record.colorName,
          taxRate: record.taxRate,
          quantity: record.quantity,
          unitPrice: record.unitPrice,
          wostAmount: record.wostAmount,
          discountAmount: record.discountAmount,
          taxAmount: record.taxAmount,
          addTaxAmount: record.addTaxAmount,
          taxPayable: record.taxPayable,
          subTotal: record.subTotal,
        });

        const categoryKey = `${catName}-${brandName}`;
        if (!invoiceCategoriesMap.has(categoryKey)) {
            invoiceCategoriesMap.set(categoryKey, {
                categoryName: catName,
                brandName: brandName,
                totals: createEmptyTotals(),
                products: [],
            });
        }
        const categoryNode = invoiceCategoriesMap.get(categoryKey)!;

        const productKey = `${sku}-${description}-${grossSellingPrice}`;
        let productNode = categoryNode.products.find(p => p.sku === sku && p.description === description && p.sellingPrice === grossSellingPrice);
        if (!productNode) {
            productNode = {
                sku,
                description,
                sellingPrice: grossSellingPrice,
                totals: createEmptyTotals(),
                items: [],
            };
            categoryNode.products.push(productNode);
        }

        // Add to product
        productNode.items.push(record);
        productNode.totals.totalItems += qty;
        productNode.totals.grossAmount += qty * grossSellingPrice;
        productNode.totals.wostAmount += valueExclTax;
        productNode.totals.discountAmount += discount;
        productNode.totals.taxAmount += salesTax;
        productNode.totals.netAmount += valueInclTax;

        // Add to category
        categoryNode.totals.totalItems += qty;
        categoryNode.totals.grossAmount += qty * grossSellingPrice;
        categoryNode.totals.wostAmount += valueExclTax;
        categoryNode.totals.discountAmount += discount;
        categoryNode.totals.taxAmount += salesTax;
        categoryNode.totals.netAmount += valueInclTax;

        // Add to return node
        returnNode.totals.totalItems += qty;
        returnNode.totals.grossAmount += qty * grossSellingPrice;
        returnNode.totals.wostAmount += valueExclTax;
        returnNode.totals.discountAmount += discount;
        returnNode.totals.taxAmount += salesTax;
        returnNode.totals.netAmount += valueInclTax;

        // Add to customer
        customerNode.totals.totalItems += qty;
        customerNode.totals.grossAmount += qty * grossSellingPrice;
        customerNode.totals.wostAmount += valueExclTax;
        customerNode.totals.discountAmount += discount;
        customerNode.totals.taxAmount += salesTax;
        customerNode.totals.netAmount += valueInclTax;

        // Add to grand totals
        grandTotals.totalItems += qty;
        grandTotals.grossAmount += qty * grossSellingPrice;
        grandTotals.wostAmount += valueExclTax;
        grandTotals.discountAmount += discount;
        grandTotals.taxAmount += salesTax;
        grandTotals.netAmount += valueInclTax;

        addedAnyItems = true;
      }

      if (addedAnyItems) {
        returnNode.categories = Array.from(invoiceCategoriesMap.values());
        returnNode.totals.invoiceCount = 1;
        customerNode.returns.push(returnNode);
        customerNode.totals.invoiceCount += 1;
        grandTotals.invoiceCount += 1;
      }
    }

    const validCustomers = Array.from(customerMap.values()).filter(c => c.returns.length > 0);

    await onProgress?.(100, 'Report generation complete');

    return {
      reportType,
      customers: validCustomers,
      flatItems,
      grandTotals,
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    };
  }
}
