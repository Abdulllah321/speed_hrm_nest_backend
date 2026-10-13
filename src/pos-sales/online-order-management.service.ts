import {
  Injectable,
  BadRequestException,
  MessageEvent,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import * as xlsx from 'xlsx';
import { ReplaySubject, Observable } from 'rxjs';
import { PosSalesService } from './pos-sales.service';
import { VoucherService } from '../pos-config/voucher.service';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

@Injectable()
export class OnlineOrderManagementService {
  private uploads = new Map<
    string,
    {
      status: string;
      progress: number;
      data: any[];
      subject: ReplaySubject<MessageEvent>;
      message?: string;
      successRecords?: number;
      failedRecords?: number;
      totalRecords?: number;
      errors?: any[];
      validationSummary?: any;
    }
  >();

  constructor(
    private prisma: PrismaService,
    private posSalesService: PosSalesService,
    private voucherService: VoucherService,
  ) {}

  private saveSession(uploadId: string, session: any) {
    try {
      const TEMP_DIR = path.join(os.tmpdir(), 'speed-limit-online-orders');
      if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
      const filePath = path.join(TEMP_DIR, `${uploadId}.json`);
      const { subject, ...state } = session;
      fs.writeFileSync(filePath, JSON.stringify(state));
    } catch (e) {}
  }

  private loadSession(uploadId: string) {
    try {
      const filePath = path.join(
        os.tmpdir(),
        'speed-limit-online-orders',
        `${uploadId}.json`,
      );
      if (fs.existsSync(filePath)) {
        const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        state.subject = new ReplaySubject<MessageEvent>(1);
        this.uploads.set(uploadId, state);
        return state;
      }
    } catch (e) {}
    return null;
  }

  private getSession(uploadId: string) {
    return this.uploads.get(uploadId) || this.loadSession(uploadId);
  }

  async uploadFile(buffer: Buffer, filename: string, locationId?: string) {
    const uploadId = 'upload-' + Date.now();
    const subject = new ReplaySubject<MessageEvent>(1);

    const newSession = {
      status: 'validating',
      progress: 0,
      data: [],
      subject,
    };
    this.uploads.set(uploadId, newSession);
    this.saveSession(uploadId, newSession);

    // Run async validation
    setTimeout(() => this.validateFile(uploadId, buffer, locationId), 50);

    return { uploadId };
  }

  /**
   * Helper to inspect and validate voucher or coupon code in our system
   */
  async resolveVoucherOrCoupon(code: string, locationId?: string) {
    if (!code || !code.trim()) return null;
    const cleanCode = code.trim();

    // 1. Check in Voucher table (GIFT, CORPORATE, CREDIT, EXCHANGE)
    const voucher = await this.prisma.voucher.findFirst({
      where: {
        code: { equals: cleanCode, mode: 'insensitive' },
        isDeleted: false,
      },
      include: {
        locations: true,
      },
    });

    if (voucher) {
      const now = new Date();
      let isValid = true;
      let status = 'VALID';
      let message = 'Valid voucher';

      if (voucher.isRedeemed) {
        isValid = false;
        status = 'ALREADY_REDEEMED';
        message = 'Voucher has already been redeemed';
      } else if (!voucher.isActive) {
        isValid = false;
        status = 'VOIDED';
        message = 'Voucher has been voided/deactivated';
      } else if (voucher.expiresAt && voucher.expiresAt < now) {
        isValid = false;
        status = 'EXPIRED';
        message = `Voucher expired on ${voucher.expiresAt.toISOString().split('T')[0]}`;
      } else if (
        locationId &&
        voucher.locations.length > 0 &&
        voucher.voucherType !== 'EXCHANGE' &&
        voucher.voucherType !== 'CREDIT'
      ) {
        const allowed = voucher.locations.some((l) => l.locationId === locationId);
        if (!allowed) {
          isValid = false;
          status = 'LOCATION_RESTRICTED';
          message = 'Voucher is not allowed at this location';
        }
      }

      return {
        type: 'VOUCHER',
        voucherType: voucher.voucherType,
        id: voucher.id,
        code: voucher.code,
        faceValue: Number(voucher.faceValue || 0),
        status,
        isValid,
        message,
      };
    }

    // 2. Check in CouponCode table (promotional discounts)
    const coupon = await this.prisma.couponCode.findFirst({
      where: {
        code: { equals: cleanCode, mode: 'insensitive' },
        isDeleted: false,
      },
    });

    if (coupon) {
      const now = new Date();
      let isValid = true;
      let status = 'VALID';
      let message = 'Valid coupon code';

      if (!coupon.isActive) {
        isValid = false;
        status = 'INACTIVE';
        message = 'Coupon code is inactive';
      } else if (coupon.expiresAt && coupon.expiresAt < now) {
        isValid = false;
        status = 'EXPIRED';
        message = `Coupon code expired on ${coupon.expiresAt.toISOString().split('T')[0]}`;
      } else if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
        isValid = false;
        status = 'LIMIT_REACHED';
        message = 'Coupon code usage limit has been reached';
      }

      return {
        type: 'COUPON',
        id: coupon.id,
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: Number(coupon.discountValue || 0),
        status,
        isValid,
        message,
      };
    }

    // 3. Not found in system
    return {
      type: 'UNKNOWN',
      code: cleanCode,
      status: 'NOT_FOUND',
      isValid: false,
      message: `Code "${cleanCode}" was not found in our voucher or coupon system`,
    };
  }

  private async validateFile(uploadId: string, buffer: Buffer, locationId?: string) {
    const session = this.getSession(uploadId);
    if (!session) return;

    try {
      session.subject.next({
        data: { type: 'status', data: { status: 'validating', progress: 10 } },
      });

      // Parse excel / CSV
      const wb = xlsx.read(buffer, { type: 'buffer', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rawData = xlsx.utils.sheet_to_json(sheet) as any[];

      if (!rawData || rawData.length === 0) {
        throw new Error('File is empty or in an invalid format.');
      }

      session.subject.next({
        data: { type: 'status', data: { status: 'validating', progress: 25 } },
      });

      // Normalize row keys (support different casings)
      const normalizedData = rawData.map((row, idx) => {
        const getVal = (...keys: string[]) => {
          for (const k of keys) {
            if (row[k] !== undefined && row[k] !== null && row[k] !== '') {
              return row[k];
            }
          }
          return undefined;
        };

        const orderNumber =
          getVal('Order Number', 'orderNumber', 'order_number', 'Order Id', 'orderId')?.toString().trim();
        const sku = getVal('SKU', 'sku', 'Item SKU', 'itemSku')?.toString().trim();
        const barcode = getVal('Barcode', 'barcode')?.toString().trim();
        const systemSku = getVal('System Sku', 'systemSku', 'system_sku')?.toString().trim();
        const couponCode = getVal('Coupon Code', 'couponCode', 'coupon_code', 'Voucher', 'voucher')?.toString().trim();
        const paymentMethod = getVal('Payment Method', 'paymentMethod', 'payment_method')?.toString().trim();
        const qty = Number(getVal('Qty', 'qty', 'Quantity', 'quantity') || 1);
        const price = Number(getVal('Price', 'price', 'Unit Price') || 0);
        const skuDiscounted = Number(getVal('SKU discounted', 'skuDiscounted', 'Discount') || 0);
        const skuActualDiscount = Number(getVal('SKU actual discount', 'skuActualDiscount') || 0);
        const shippingCharges = Number(getVal('Shipping Charges', 'shippingCharges', 'Shipping') || 0);
        const orderTotal = Number(getVal('Order Total', 'orderTotal', 'Total') || 0);

        let orderedAt: Date | null = null;
        const rawDate = getVal('Ordered At', 'orderedAt', 'Order Date', 'Date');
        if (rawDate) {
          const parsed = new Date(rawDate);
          if (!isNaN(parsed.getTime())) orderedAt = parsed;
        }

        return {
          _rowIndex: idx + 2, // Excel row index
          orderNumber,
          orderId: getVal('Order Id', 'orderId')?.toString().trim() || orderNumber,
          sku,
          barcode,
          systemSku,
          size: getVal('Size', 'size')?.toString().trim(),
          name: getVal('Name', 'name', 'Product Name')?.toString().trim(),
          brand: getVal('Brand', 'brand')?.toString().trim(),
          qty: isNaN(qty) || qty <= 0 ? 1 : qty,
          price: isNaN(price) ? 0 : price,
          paidPrice: Number(getVal('Paid Price', 'paidPrice') || 0),
          subTotalPaidPrice: Number(getVal('Sub Total (Paid Price)', 'subTotalPaidPrice') || 0),
          subTotalPrice: Number(getVal('Sub Total (Price)', 'subTotalPrice') || price * qty),
          skuDiscounted,
          skuActualDiscount,
          shippingCharges,
          orderTotal,
          itemStatus: getVal('Item Status', 'itemStatus')?.toString().trim() || 'pending',
          realMarketStatus: getVal('Real Market Status', 'realMarketStatus')?.toString().trim(),
          couponCode,
          paymentMethod: paymentMethod || 'Cash',
          trackingNumber: getVal('Tracking Number', 'trackingNumber')?.toString().trim(),
          marketplace: getVal('Marketplace', 'marketplace')?.toString().trim() || 'Online',
          channel: getVal('Channel', 'channel')?.toString().trim() || 'Website',
          orderedAt,
          orderMonth: getVal('Order Month', 'orderMonth')?.toString().trim(),
          orderYear: getVal('Order Year', 'orderYear')?.toString().trim(),
          customerType: getVal('Customer Type', 'customerType')?.toString().trim(),
          customerName: getVal('Customer Name', 'customerName', 'Customer')?.toString().trim() || 'Guest',
          email: getVal('Email', 'email')?.toString().trim(),
          city: getVal('City', 'city')?.toString().trim() || '—',
          phone: getVal('Phone', 'phone', 'Contact')?.toString().trim(),
          address: getVal('Address', 'address')?.toString().trim() || '—',
          note: getVal('Note', 'note')?.toString().trim(),
          fulfilledByWarehouse: getVal('Fulfilled By Warehouse', 'fulfilledByWarehouse')?.toString().trim(),
          shipping: getVal('Shipping', 'shipping')?.toString().trim(),
        };
      });

      session.subject.next({
        data: { type: 'status', data: { status: 'validating', progress: 45 } },
      });

      // ── Gather unique entities for batch database verification ──
      const uniqueOrderNumbers = Array.from(
        new Set(normalizedData.map((r) => r.orderNumber).filter(Boolean)),
      ) as string[];

      const uniqueSkus = Array.from(
        new Set(
          normalizedData
            .flatMap((r) => [r.sku, r.systemSku, r.barcode])
            .filter(Boolean),
        ),
      ) as string[];

      const uniqueCoupons = Array.from(
        new Set(normalizedData.map((r) => r.couponCode).filter(Boolean)),
      ) as string[];

      // 1. Check existing orders in DB (duplicate detection)
      const existingDbOrders = await this.prisma.onlineOrder.findMany({
        where: { orderNumber: { in: uniqueOrderNumbers } },
        select: { orderNumber: true, itemStatus: true, salesOrderId: true },
      });

      const existingOrderMap = new Map<string, any>();
      for (const o of existingDbOrders) {
        if (o.orderNumber) {
          existingOrderMap.set(o.orderNumber, o);
        }
      }

      // 2. Fetch DB Items for SKU matching
      const dbItems = await this.prisma.item.findMany({
        where: {
          OR: [
            { sku: { in: uniqueSkus } },
            { barCode: { in: uniqueSkus } },
            { itemId: { in: uniqueSkus } },
          ],
        },
        select: { id: true, sku: true, barCode: true, itemId: true, description: true, taxRate1: true },
      });

      const dbItemMap = new Map<string, any>();
      for (const it of dbItems) {
        if (it.sku) dbItemMap.set(it.sku.trim().toLowerCase(), it);
        if (it.barCode) dbItemMap.set(it.barCode.trim().toLowerCase(), it);
        if (it.itemId) dbItemMap.set(it.itemId.trim().toLowerCase(), it);
      }

      // 3. Check Vouchers / Coupons
      const voucherResults = new Map<string, any>();
      for (const code of uniqueCoupons) {
        const resolved = await this.resolveVoucherOrCoupon(code, locationId);
        if (resolved) voucherResults.set(code.toLowerCase(), resolved);
      }

      session.subject.next({
        data: { type: 'status', data: { status: 'validating', progress: 75 } },
      });

      // ── Detailed row validation ──
      const errors: any[] = [];
      let duplicateOrdersCount = 0;
      let alreadyPostedCount = 0;
      let voucherIssuesCount = 0;
      let missingItemCount = 0;

      for (const row of normalizedData) {
        if (!row.orderNumber) {
          errors.push({
            row: row._rowIndex,
            orderNumber: 'N/A',
            type: 'error',
            message: 'Order Number is required',
          });
          continue;
        }

        // Duplicate checks
        const existingOrder = existingOrderMap.get(row.orderNumber);
        if (existingOrder) {
          if (existingOrder.itemStatus === 'posted' || existingOrder.salesOrderId) {
            alreadyPostedCount++;
            errors.push({
              row: row._rowIndex,
              orderNumber: row.orderNumber,
              type: 'warning',
              message: `Order #${row.orderNumber} is already posted in POS (will be skipped during import).`,
            });
          } else {
            duplicateOrdersCount++;
            errors.push({
              row: row._rowIndex,
              orderNumber: row.orderNumber,
              type: 'info',
              message: `Order #${row.orderNumber} already exists in pending state (will be refreshed).`,
            });
          }
        }

        // Item SKU check
        const targetSku = (row.systemSku || row.barcode || row.sku || '').trim().toLowerCase();
        let matched = dbItemMap.get(targetSku);
        if (!matched && row.sku) {
          const baseSku = row.sku.split('_')[0].trim().toLowerCase();
          matched = dbItemMap.get(baseSku);
        }

        if (!matched) {
          missingItemCount++;
          errors.push({
            row: row._rowIndex,
            orderNumber: row.orderNumber,
            sku: row.sku || row.systemSku,
            type: 'warning',
            message: `SKU "${row.sku || row.systemSku}" not found in current inventory index (fuzzy search will be attempted on post).`,
          });
        }

        // Voucher check
        if (row.couponCode) {
          const vRes = voucherResults.get(row.couponCode.toLowerCase());
          if (!vRes || !vRes.isValid) {
            voucherIssuesCount++;
            errors.push({
              row: row._rowIndex,
              orderNumber: row.orderNumber,
              code: row.couponCode,
              type: 'error',
              message: vRes?.message || `Voucher/Coupon "${row.couponCode}" is invalid or expired.`,
            });
          }
        }
      }

      const criticalErrors = errors.filter((e) => e.type === 'error');
      const validRecords = normalizedData.length - criticalErrors.length;

      session.data = normalizedData;
      session.status = 'validated';
      session.progress = 100;
      session.totalRecords = normalizedData.length;
      session.errors = errors;
      session.validationSummary = {
        totalRows: normalizedData.length,
        totalOrders: uniqueOrderNumbers.length,
        alreadyPostedOrders: alreadyPostedCount,
        pendingDuplicates: duplicateOrdersCount,
        voucherIssues: voucherIssuesCount,
        missingItems: missingItemCount,
      };

      this.saveSession(uploadId, session);

      session.subject.next({
        data: {
          type: 'status',
          data: {
            status: 'validated',
            progress: 100,
            totalRecords: normalizedData.length,
            validRecords: validRecords > 0 ? validRecords : normalizedData.length,
            failedRecords: criticalErrors.length,
            errors,
            summary: session.validationSummary,
          },
        },
      });
    } catch (error: any) {
      session.status = 'failed';
      session.message = error.message || 'Failed to parse file';
      this.saveSession(uploadId, session);
      session.subject.next({
        data: {
          type: 'failed',
          data: { message: session.message },
        },
      });
    }
  }

  async confirmUpload(uploadId: string, locationId: string) {
    const session = this.getSession(uploadId);
    if (!session || session.status !== 'validated') {
      throw new BadRequestException('Invalid or expired upload session');
    }

    session.status = 'processing';
    this.saveSession(uploadId, session);
    session.subject.next({
      data: { type: 'status', data: { status: 'processing', progress: 0 } },
    });

    // Process asynchronously
    setTimeout(() => this.processUpload(uploadId, locationId), 50);

    return { status: true, message: 'Processing started' };
  }

  private async processUpload(uploadId: string, locationId: string) {
    const session = this.getSession(uploadId);
    if (!session) return;

    try {
      const data = session.data as any[];
      let successCount = 0;
      let skippedCount = 0;

      // Group incoming rows by orderNumber
      const incomingOrders = new Map<string, any[]>();
      for (const row of data) {
        const orderNum = row.orderNumber;
        if (!orderNum) continue;
        if (!incomingOrders.has(orderNum)) {
          incomingOrders.set(orderNum, []);
        }
        incomingOrders.get(orderNum)!.push(row);
      }

      // ── DE-DUPLICATION ARCHITECTURE ──
      // Check which orders already exist in pos_online_orders
      const orderNumbers = Array.from(incomingOrders.keys());
      const existingOrders = await this.prisma.onlineOrder.findMany({
        where: { orderNumber: { in: orderNumbers } },
        select: { id: true, orderNumber: true, itemStatus: true, salesOrderId: true },
      });

      const alreadyPostedNumbers = new Set(
        existingOrders
          .filter((o) => o.itemStatus === 'posted' || o.salesOrderId)
          .map((o) => o.orderNumber),
      );

      // Clean up previous unposted rows to avoid stacking duplicates
      const unpostedNumbersToDelete = Array.from(
        new Set(
          existingOrders
            .filter((o) => o.itemStatus !== 'posted' && !o.salesOrderId)
            .map((o) => o.orderNumber),
        ),
      );

      if (unpostedNumbersToDelete.length > 0) {
        await this.prisma.onlineOrder.deleteMany({
          where: { orderNumber: { in: unpostedNumbersToDelete as string[] } },
        });
      }

      // Filter insertData: Skip orders that are already posted
      const finalRowsToInsert: any[] = [];
      for (const [orderNum, rows] of incomingOrders.entries()) {
        if (alreadyPostedNumbers.has(orderNum)) {
          skippedCount += rows.length;
          continue;
        }

        for (const row of rows) {
          finalRowsToInsert.push({
            orderNumber: row.orderNumber,
            orderId: row.orderId,
            sku: row.sku,
            barcode: row.barcode,
            systemSku: row.systemSku,
            size: row.size,
            name: row.name,
            brand: row.brand,
            qty: row.qty,
            price: row.price,
            paidPrice: row.paidPrice,
            subTotalPaidPrice: row.subTotalPaidPrice,
            subTotalPrice: row.subTotalPrice,
            skuDiscounted: row.skuDiscounted,
            skuActualDiscount: row.skuActualDiscount,
            shippingCharges: row.shippingCharges,
            orderTotal: row.orderTotal,
            itemStatus: 'pending',
            realMarketStatus: row.realMarketStatus,
            couponCode: row.couponCode,
            paymentMethod: row.paymentMethod,
            trackingNumber: row.trackingNumber,
            marketplace: row.marketplace,
            channel: row.channel,
            orderedAt: row.orderedAt,
            orderMonth: row.orderMonth,
            orderYear: row.orderYear,
            customerType: row.customerType,
            customerName: row.customerName,
            email: row.email,
            city: row.city,
            phone: row.phone,
            address: row.address,
            note: row.note,
            fulfilledByWarehouse: row.fulfilledByWarehouse,
            shipping: row.shipping,
            locationId: locationId,
          });
        }
      }

      // Bulk insert in chunks of 500
      const chunkSize = 500;
      for (let i = 0; i < finalRowsToInsert.length; i += chunkSize) {
        const chunk = finalRowsToInsert.slice(i, i + chunkSize);
        await this.prisma.onlineOrder.createMany({
          data: chunk,
        });

        successCount += chunk.length;

        session.subject.next({
          data: {
            type: 'progress',
            data: {
              progress: Math.floor(((i + chunk.length) / finalRowsToInsert.length) * 100),
              processedRecords: successCount,
              successRecords: successCount,
              failedRecords: skippedCount,
              totalRecords: data.length,
              status: 'processing',
            },
          },
        });
      }

      session.status = 'completed';
      session.successRecords = successCount;
      session.failedRecords = skippedCount;
      this.saveSession(uploadId, session);

      session.subject.next({
        data: {
          type: 'completed',
          data: {
            status: 'completed',
            progress: 100,
            successRecords: successCount,
            failedRecords: skippedCount,
            totalRecords: data.length,
            message: `Successfully imported ${successCount} items across ${incomingOrders.size - alreadyPostedNumbers.size} orders (${alreadyPostedNumbers.size} already posted orders skipped).`,
            errors: [],
          },
        },
      });

      setTimeout(() => {
        session.subject.complete();
        this.uploads.delete(uploadId);
      }, 15000);
    } catch (error: any) {
      console.error('Process upload failed:', error);
      session.status = 'failed';
      this.saveSession(uploadId, session);
      session.subject.next({
        data: {
          type: 'failed',
          data: { message: error.message || 'Import failed' },
        },
      });
    }
  }

  subscribeToEvents(uploadId: string): Observable<MessageEvent> {
    const session = this.getSession(uploadId);
    if (!session) {
      const subject = new ReplaySubject<MessageEvent>(1);
      setTimeout(() => {
        subject.next({
          data: { type: 'failed', data: { message: 'Session not found' } },
        });
        subject.complete();
      }, 100);
      return subject.asObservable();
    }

    const heartbeatInterval = setInterval(() => {
      if (
        session.status !== 'completed' &&
        session.status !== 'failed' &&
        session.status !== 'cancelled'
      ) {
        session.subject.next({ data: { type: 'heartbeat', data: {} } });
      } else {
        clearInterval(heartbeatInterval);
      }
    }, 10000);

    return session.subject.asObservable();
  }

  getUploadStatus(uploadId: string) {
    const session = this.getSession(uploadId);
    if (!session) return { status: 'failed', message: 'Session not found' };

    return {
      status: session.status,
      progress: session.progress,
      totalRecords: session.totalRecords || session.data?.length || 0,
      message: session.message,
      successRecords: session.successRecords || 0,
      failedRecords: session.failedRecords || 0,
      errors: session.errors || [],
      summary: session.validationSummary,
    };
  }

  cancelUpload(uploadId: string) {
    const session = this.getSession(uploadId);
    if (session) {
      session.status = 'cancelled';
      this.saveSession(uploadId, session);
      session.subject.next({
        data: { type: 'cancelled', data: { status: 'cancelled' } },
      });
      session.subject.complete();
      this.uploads.delete(uploadId);
    }
  }

  /**
   * Fetch all online orders, grouped with step-by-step calculations and enriched stock/voucher data
   */
  async getGroupedOrders(locationId?: string) {
    const allRows = await this.prisma.onlineOrder.findMany({
      where: locationId ? ({ locationId } as any) : undefined,
      include: {
        salesOrder: {
          select: { id: true, orderNumber: true, status: true, grandTotal: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Collect unique coupon codes and SKUs to bulk query voucher status & stock
    const couponCodes = Array.from(
      new Set(allRows.map((r) => r.couponCode?.trim()).filter(Boolean)),
    ) as string[];

    const voucherStatusMap = new Map<string, any>();
    for (const code of couponCodes) {
      const v = await this.resolveVoucherOrCoupon(code, locationId);
      if (v) voucherStatusMap.set(code.toLowerCase(), v);
    }

    // Group rows by orderNumber
    const grouped = new Map<string, any>();

    for (const row of allRows) {
      const key = row.orderNumber || row.orderId || row.id;

      if (!grouped.has(key)) {
        grouped.set(key, {
          orderNumber: row.orderNumber,
          orderId: row.orderId,
          customerName: row.customerName,
          phone: row.phone,
          email: row.email,
          city: row.city,
          address: row.address,
          paymentMethod: row.paymentMethod || 'Cash',
          trackingNumber: row.trackingNumber,
          marketplace: row.marketplace,
          channel: row.channel,
          orderedAt: row.orderedAt,
          status: row.salesOrderId || row.itemStatus === 'posted' ? 'posted' : 'pending',
          salesOrderId: row.salesOrderId,
          salesOrderNumber: row.salesOrder?.orderNumber,
          salesOrder: row.salesOrder
            ? {
                id: row.salesOrder.id,
                orderNumber: row.salesOrder.orderNumber,
                status: row.salesOrder.status,
                grandTotal: Number(row.salesOrder.grandTotal || 0),
                totalAmount: Number(row.salesOrder.grandTotal || 0),
              }
            : null,
          shippingCharges: Number(row.shippingCharges || 0),
          couponCode: row.couponCode,
          voucherInfo: row.couponCode ? voucherStatusMap.get(row.couponCode.trim().toLowerCase()) : null,
          items: [],
          grossSubtotal: 0,
          totalDiscount: 0,
          voucherRedeemed: 0,
          orderTotal: 0,
        });
      }

      const order = grouped.get(key);
      order.items.push(row);

      const itemPrice = Number(row.price || 0);
      const itemQty = Number(row.qty || 1);
      const lineGross = itemPrice * itemQty;
      order.grossSubtotal += lineGross;

      // Discounts
      const discPercent = Number(row.skuActualDiscount || row.skuDiscounted || 0);
      const lineDisc = lineGross * (discPercent / 100);
      order.totalDiscount += lineDisc;

      if (Number(row.shippingCharges || 0) > order.shippingCharges) {
        order.shippingCharges = Number(row.shippingCharges);
      }
    }

    // Step-by-step final financial calculations for each order
    const result = Array.from(grouped.values()).map((order) => {
      // 1. Items after discount
      const itemsNet = Math.max(0, order.grossSubtotal - order.totalDiscount);

      // 2. Voucher deduction
      let voucherDeduction = 0;
      if (order.voucherInfo && order.voucherInfo.isValid) {
        if (order.voucherInfo.type === 'VOUCHER') {
          voucherDeduction = Math.min(
            Number(order.voucherInfo.faceValue || 0),
            itemsNet + order.shippingCharges,
          );
        } else if (order.voucherInfo.type === 'COUPON') {
          if (order.voucherInfo.discountType === 'PERCENT') {
            voucherDeduction = itemsNet * (Number(order.voucherInfo.discountValue || 0) / 100);
          } else {
            voucherDeduction = Math.min(
              Number(order.voucherInfo.discountValue || 0),
              itemsNet,
            );
          }
        }
      }
      order.voucherRedeemed = Math.round(voucherDeduction * 100) / 100;

      // 3. Final payable grand total
      const calculatedGrandTotal = Math.max(
        0,
        Math.round(itemsNet + order.shippingCharges - order.voucherRedeemed),
      );

      // Read max order total from raw row if present, otherwise use calculated
      const rawOrderTotal = Math.max(
        ...order.items.map((i: any) => Number(i.orderTotal || 0)),
      );
      order.orderTotal = rawOrderTotal > 0 ? rawOrderTotal : calculatedGrandTotal;

      // 4. Remaining tender amount to pay (Cash/Card)
      order.payableAfterVoucher = Math.max(0, order.orderTotal - order.voucherRedeemed);

      return order;
    });

    return {
      status: true,
      data: result,
    };
  }

  /**
   * Post a single online order to POS Sales with strict voucher & tender balancing
   */
  async postOrder(
    orderNumber: string,
    cashierUserId: string,
    locationId: string,
    ctxUser: any,
    posId?: string,
    terminalId?: string,
  ) {
    const orderRows = await this.prisma.onlineOrder.findMany({
      where: { orderNumber },
    });

    if (!orderRows || orderRows.length === 0) {
      throw new NotFoundException(`Order with number "${orderNumber}" not found.`);
    }

    // If already posted, reject duplicate submission
    const alreadyPosted = orderRows.some(
      (r) => r.itemStatus === 'posted' || r.salesOrderId,
    );
    if (alreadyPosted) {
      throw new BadRequestException(
        `Order "${orderNumber}" has already been posted to POS. Duplicate posting is prevented.`,
      );
    }

    const skus = Array.from(
      new Set(
        orderRows
          .flatMap((r) => [r.sku?.trim(), r.systemSku?.trim(), r.barcode?.trim()])
          .filter(Boolean),
      ),
    ) as string[];

    const dbItems = await this.prisma.item.findMany({
      where: {
        OR: [
          { sku: { in: skus } },
          { barCode: { in: skus } },
          { itemId: { in: skus } },
        ],
      },
    });

    const matchStr = (val: string | null | undefined, dbVal: string | null | undefined) => {
      if (!val || !dbVal) return false;
      return val.trim().toLowerCase() === dbVal.trim().toLowerCase();
    };

    const itemsPayload: any[] = [];
    let grossItemsTotal = 0;
    let totalLineDiscount = 0;

    for (const row of orderRows) {
      let item: any = null;

      // 1. Try matching System SKU
      if (row.systemSku) {
        item = dbItems.find(
          (i) =>
            matchStr(row.systemSku, i.sku) ||
            matchStr(row.systemSku, i.barCode) ||
            matchStr(row.systemSku, i.itemId),
        );
      }

      // 2. Try matching Barcode
      if (!item && row.barcode) {
        item = dbItems.find(
          (i) => matchStr(row.barcode, i.barCode) || matchStr(row.barcode, i.sku),
        );
      }

      // 3. Try matching SKU
      if (!item && row.sku) {
        item = dbItems.find(
          (i) =>
            matchStr(row.sku, i.sku) ||
            matchStr(row.sku, i.barCode) ||
            matchStr(row.sku, i.itemId),
        );
      }

      // 4. Fuzzy fallback search for e-commerce SKU variants
      if (!item && row.sku) {
        const baseSku = row.sku.split('_')[0].trim();
        const parts = [baseSku, ...row.sku.split(/[-_ ]+/).filter((p: string) => p.length >= 4)];
        const uniqueParts = [...new Set(parts)];

        for (const part of uniqueParts) {
          const fallbackItems = await this.prisma.item.findMany({
            where: {
              OR: [
                { sku: { equals: part, mode: 'insensitive' } },
                { barCode: { equals: part, mode: 'insensitive' } },
              ],
              isActive: true,
            },
          });

          if (fallbackItems.length > 0) {
            item = fallbackItems[0];
            break;
          }
        }
      }

      if (!item) {
        throw new BadRequestException(
          `Item with SKU "${row.sku || row.systemSku}" not found in inventory.`,
        );
      }

      const qty = Number(row.qty) || 1;
      const price = Number(row.price) || 0;
      const rawDiscountCol = row.skuActualDiscount || row.skuDiscounted;
      const discPercent = Number(rawDiscountCol) || 0;
      const discAmount = price * qty * (discPercent / 100);

      grossItemsTotal += price * qty;
      totalLineDiscount += discAmount;

      itemsPayload.push({
        itemId: item.id,
        quantity: qty,
        unitPrice: price,
        discountPercent: Math.min(discPercent, 100),
        taxPercent: Number((item as any).taxRate1 || 0),
      });
    }

    const itemsNet = Math.max(0, grossItemsTotal - totalLineDiscount);
    const shippingFee = Number(orderRows[0].shippingCharges || 0);

    // ── VOUCHER & COUPON RESOLUTION ──
    const couponCode = orderRows.find((r) => r.couponCode)?.couponCode?.trim();
    let voucherRedemptions: any[] = [];
    let couponId: string | undefined = undefined;
    let voucherDeduction = 0;

    if (couponCode) {
      const resolved = await this.resolveVoucherOrCoupon(couponCode, locationId);
      if (resolved && resolved.isValid) {
        if (resolved.type === 'VOUCHER') {
          voucherDeduction = Math.min(Number(resolved.faceValue || 0), itemsNet + shippingFee);
          voucherRedemptions = [
            {
              voucherId: resolved.id,
              code: resolved.code,
              amount: voucherDeduction,
            },
          ];
        } else if (resolved.type === 'COUPON') {
          couponId = resolved.id;
        }
      } else if (resolved && !resolved.isValid) {
        console.warn(`[ONLINE ORDER] Voucher "${couponCode}" issue: ${resolved.message}`);
      }
    }

    // ── TENDER BALANCING ──
    // In POS Sales: totalPaid = sum(tenders) + sum(voucherRedemptions)
    // Overpayment throws an error, so tender amount MUST match the remaining amount after voucher
    const rawGrandTotal = Math.max(...orderRows.map((r) => Number(r.orderTotal || 0)));
    const targetGrandTotal = rawGrandTotal > 0 ? rawGrandTotal : Math.round(itemsNet + shippingFee);
    const remainingPayable = Math.max(0, targetGrandTotal - voucherDeduction);

    // Map payment method
    const paymentStr = orderRows[0].paymentMethod?.toLowerCase() || 'cash';
    let tenderMethod = 'cash';
    if (paymentStr.includes('card') || paymentStr.includes('visa') || paymentStr.includes('master')) {
      tenderMethod = 'card';
    } else if (paymentStr.includes('bank') || paymentStr.includes('online') || paymentStr.includes('transfer')) {
      tenderMethod = 'bank_transfer';
    }

    const tenders: any[] = [];
    if (remainingPayable > 0) {
      tenders.push({
        method: tenderMethod,
        amount: remainingPayable,
      });
    }

    // Build Sales Order DTO
    const dto: any = {
      locationId,
      posId: posId || ctxUser?.posId,
      terminalId: terminalId || ctxUser?.terminalId,
      cashierUserId,
      notes: `Online Order: ${orderNumber}`,
      isOnlineOrder: true, // Bypasses 15-second cashier spam check
      items: itemsPayload,
      tenders,
      voucherRedemptions: voucherRedemptions.length > 0 ? voucherRedemptions : undefined,
      couponId,
    };

    const ctx = {
      userId: ctxUser?.id,
    };

    // Create the POS sales order
    const createdOrder: any = await this.posSalesService.createOrder(
      dto,
      cashierUserId,
      ctx,
    );

    if (!createdOrder.status || !createdOrder.data) {
      throw new BadRequestException(
        createdOrder.message || 'Failed to create sales order in POS.',
      );
    }

    // Update online order rows to "posted"
    await this.prisma.onlineOrder.updateMany({
      where: { orderNumber },
      data: {
        itemStatus: 'posted',
        salesOrderId: createdOrder.data.id,
      },
    });

    return {
      status: true,
      message: `Order #${orderNumber} posted successfully.`,
      data: createdOrder.data,
    };
  }

  /**
   * Bulk post multiple selected online orders sequentially with clear per-order feedback
   */
  async bulkPostOrders(
    orderNumbers: string[],
    cashierUserId: string,
    locationId: string,
    ctxUser: any,
    posId?: string,
    terminalId?: string,
  ) {
    if (!orderNumbers || orderNumbers.length === 0) {
      throw new BadRequestException('No order numbers provided for bulk post.');
    }

    const results: any[] = [];
    let successCount = 0;
    let failedCount = 0;

    for (const orderNum of orderNumbers) {
      try {
        const res = await this.postOrder(
          orderNum,
          cashierUserId,
          locationId,
          ctxUser,
          posId,
          terminalId,
        );
        successCount++;
        results.push({
          orderNumber: orderNum,
          status: 'success',
          message: res.message,
          data: res.data,
        });
      } catch (err: any) {
        failedCount++;
        results.push({
          orderNumber: orderNum,
          status: 'failed',
          message: err.message || 'Unknown error during order posting',
        });
      }
    }

    return {
      status: true,
      total: orderNumbers.length,
      successCount,
      failedCount,
      results,
    };
  }

  /**
   * Delete an unposted order from pos_online_orders
   */
  async deleteOrder(orderNumber: string) {
    const existing = await this.prisma.onlineOrder.findFirst({
      where: { orderNumber },
    });

    if (!existing) {
      throw new NotFoundException(`Order ${orderNumber} not found.`);
    }

    if (existing.itemStatus === 'posted' || existing.salesOrderId) {
      throw new BadRequestException(`Cannot delete order ${orderNumber} because it is already posted.`);
    }

    await this.prisma.onlineOrder.deleteMany({
      where: { orderNumber },
    });

    return { status: true, message: `Order ${orderNumber} deleted successfully.` };
  }
}
