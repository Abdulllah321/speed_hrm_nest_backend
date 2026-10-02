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

@Injectable()
export class OnlineOrderManagementService {
  private uploads = new Map<
    string,
    {
      status: string;
      progress: number;
      data: any[];
      subject: ReplaySubject<MessageEvent>;
    }
  >();

  constructor(
    private prisma: PrismaService,
    private posSalesService: PosSalesService,
  ) {}

  async uploadFile(buffer: Buffer, filename: string) {
    const uploadId = 'upload-' + Date.now();
    // Use ReplaySubject(1) so late subscribers get the last status
    const subject = new ReplaySubject<MessageEvent>(1);

    this.uploads.set(uploadId, {
      status: 'validating',
      progress: 0,
      data: [],
      subject,
    });

    // Async validation
    setTimeout(() => this.validateFile(uploadId, buffer), 100);

    return { uploadId };
  }

  private async validateFile(uploadId: string, buffer: Buffer) {
    const session = this.uploads.get(uploadId);
    if (!session) return;

    try {
      session.subject.next({
        data: { type: 'status', data: { status: 'validating', progress: 10 } },
      });

      // Parse excel
      const wb = xlsx.read(buffer, { type: 'buffer', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rawData = xlsx.utils.sheet_to_json(sheet) as any[];

      if (!rawData || rawData.length === 0) {
        throw new Error('File is empty or invalid format.');
      }

      session.data = rawData;
      session.status = 'validated';
      session.progress = 100;

      session.subject.next({
        data: {
          type: 'status',
          data: {
            status: 'validated',
            progress: 100,
            totalRecords: rawData.length,
            validRecords: rawData.length,
            errors: [],
          },
        },
      });
    } catch (error: any) {
      session.status = 'failed';
      session.subject.next({
        data: {
          type: 'failed',
          data: { message: error.message || 'Failed to parse file' },
        },
      });
    }
  }

  async confirmUpload(uploadId: string) {
    const session = this.uploads.get(uploadId);
    if (!session || session.status !== 'validated') {
      throw new BadRequestException('Invalid or expired upload session');
    }

    session.status = 'processing';
    session.subject.next({
      data: { type: 'status', data: { status: 'processing', progress: 0 } },
    });

    // Process asynchronously
    setTimeout(() => this.processUpload(uploadId), 100);

    return { status: true, message: 'Processing started' };
  }

  private async processUpload(uploadId: string) {
    const session = this.uploads.get(uploadId);
    if (!session) return;

    try {
      const data = session.data;
      let successCount = 0;
      let failedCount = 0;

      // Prepare all records for bulk insertion (much faster)
      const insertData = data.map((row) => {
        let orderedAt: Date | null = null;
        if (row['Ordered At']) {
          const parsedDate = new Date(row['Ordered At']);
          if (!isNaN(parsedDate.getTime())) {
            orderedAt = parsedDate;
          }
        }

        return {
          orderNumber: row['Order Number']?.toString(),
          orderId: row['Order Id']?.toString(),
          sku: row['SKU']?.toString(),
          barcode: row['Barcode']?.toString(),
          systemSku: row['System Sku']?.toString(),
          size: row['Size']?.toString(),
          name: row['Name']?.toString(),
          brand: row['Brand']?.toString(),
          qty: Number(row['Qty']) || 1,
          price: Number(row['Price']) || 0,
          paidPrice: Number(row['Paid Price']) || 0,
          subTotalPaidPrice: Number(row['Sub Total (Paid Price)']) || 0,
          subTotalPrice: Number(row['Sub Total (Price)']) || 0,
          skuDiscounted: Number(row['SKU discounted']) || 0,
          skuActualDiscount: Number(row['SKU actual discount']) || 0,
          shippingCharges: Number(row['Shipping Charges']) || 0,
          orderTotal: Number(row['Order Total']) || 0,
          itemStatus: row['Item Status']?.toString(),
          realMarketStatus: row['Real Market Status']?.toString(),
          couponCode: row['Coupon Code']?.toString(),
          paymentMethod: row['Payment Method']?.toString(),
          trackingNumber: row['Tracking Number']?.toString(),
          marketplace: row['Marketplace']?.toString(),
          channel: row['Channel']?.toString(),
          orderedAt: orderedAt,
          orderMonth: row['Order Month']?.toString(),
          orderYear: row['Order Year']?.toString(),
          customerType: row['Customer Type']?.toString(),
          customerName: row['Customer Name']?.toString(),
          email: row['Email']?.toString(),
          city: row['City']?.toString(),
          phone: row['Phone']?.toString(),
          address: row['Address']?.toString(),
          note: row['Note']?.toString(),
          fulfilledByWarehouse: row['Fulfilled By Warehouse']?.toString(),
          shipping: row['Shipping']?.toString(),
        };
      });

      // Perform bulk insert using Prisma createMany (fast)
      try {
        // To avoid overloading, insert in chunks of 1000
        const chunkSize = 1000;
        for (let i = 0; i < insertData.length; i += chunkSize) {
          const chunk = insertData.slice(i, i + chunkSize);
          await this.prisma.onlineOrder.createMany({
            data: chunk,
            skipDuplicates: true, // Handle safe insertion if needed
          });

          successCount += chunk.length;

          // Send progress update
          session.subject.next({
            data: {
              type: 'progress',
              data: {
                progress: Math.floor(
                  ((i + chunk.length) / insertData.length) * 100,
                ),
                processedRecords: successCount,
                successRecords: successCount,
                failedRecords: 0,
                totalRecords: insertData.length,
                status: 'processing',
              },
            },
          });
        }
      } catch (err) {
        console.error('Bulk insert failed:', err);
        failedCount = insertData.length; // If chunk fails, simplified error handling
        throw new Error('Database insertion failed');
      }

      session.status = 'completed';
      session.subject.next({
        data: {
          type: 'completed',
          data: {
            status: 'completed',
            progress: 100,
            successRecords: successCount,
            failedRecords: failedCount,
            totalRecords: data.length,
            errors: [],
          },
        },
      });

      setTimeout(() => {
        session.subject.complete();
        this.uploads.delete(uploadId);
      }, 10000); // Wait longer before deleting so polling can fetch final status
    } catch (error: any) {
      session.status = 'failed';
      session.subject.next({
        data: {
          type: 'failed',
          data: { message: error.message || 'Import failed' },
        },
      });
    }
  }

  subscribeToEvents(uploadId: string): Observable<MessageEvent> {
    const session = this.uploads.get(uploadId);
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
    const session = this.uploads.get(uploadId);
    if (!session) return { status: 'failed', message: 'Session not found' };

    return {
      status: session.status,
      progress: session.progress,
      totalRecords: session.data?.length || 0,
    };
  }

  cancelUpload(uploadId: string) {
    const session = this.uploads.get(uploadId);
    if (session) {
      session.status = 'cancelled';
      session.subject.next({
        data: { type: 'cancelled', data: { status: 'cancelled' } },
      });
      session.subject.complete();
      this.uploads.delete(uploadId);
    }
  }

  async getGroupedOrders() {
    // Fetch all online orders
    const allRows = await this.prisma.onlineOrder.findMany({
      orderBy: { createdAt: 'desc' },
    });

    // Group by orderNumber or orderId (prefer orderNumber if available)
    const grouped = new Map<string, any>();

    for (const row of allRows) {
      const key = row.orderNumber || row.orderId || row.id;

      if (!grouped.has(key)) {
        grouped.set(key, {
          orderNumber: row.orderNumber,
          orderId: row.orderId,
          customerName: row.customerName,
          phone: row.phone,
          city: row.city,
          address: row.address,
          paymentMethod: row.paymentMethod,
          orderTotal: 0, // We can sum this up or take the max since it might be repeated
          orderedAt: row.orderedAt,
          status: row.itemStatus,
          items: [],
        });
      }

      const order = grouped.get(key);
      order.items.push(row);
      // Assuming each row has its own qty and price which sums to order total, or the row itself has the final orderTotal duplicated
      // If it's duplicated, we can just assign it. We'll assign the highest orderTotal found in the rows.
      if (Number(row.orderTotal) > order.orderTotal) {
        order.orderTotal = Number(row.orderTotal);
      }
    }

    return {
      status: true,
      data: Array.from(grouped.values()),
    };
  }

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
      throw new NotFoundException(
        `Order with number ${orderNumber} not found.`,
      );
    }

    const skus = Array.from(
      new Set(
        orderRows
          .flatMap((r) => [
            r.sku?.trim(),
            r.systemSku?.trim(),
            r.barcode?.trim(),
          ])
          .filter(Boolean),
      ),
    );

    // Find corresponding items in the DB
    // We will fetch items using case-insensitive match for the SKUs if possible,
    // but Prisma 'in' doesn't support case-insensitive directly.
    // We'll fetch broadly by bringing everything that matches the array
    const dbItems = await this.prisma.item.findMany({
      where: {
        OR: [
          { sku: { in: skus as string[] } },
          { barCode: { in: skus as string[] } },
          { itemId: { in: skus as string[] } },
        ],
      },
    });

    // Also fetch by contains if possible? It's better to do the match case-insensitively in code.

    console.log('== DEBUG POST ORDER ==');
    console.log('Order SKUs from file:', skus);
    console.log(
      'Matched dbItems:',
      dbItems.map((i) => ({
        id: i.id,
        sku: i.sku,
        barCode: i.barCode,
        systemSku: (i as any).systemSku,
      })),
    );

    const itemsPayload = [];
    let grandTotal = 0;

    for (const row of orderRows) {
      // 1. Try matching System SKU from Excel to DB (sku, barCode, itemId)
      let item = null;

      const matchStr = (val: string, dbVal: string) => {
        if (!val || !dbVal) return false;
        return val.trim().toLowerCase() === dbVal.trim().toLowerCase();
      };

      if (row.systemSku) {
        item = dbItems.find(
          (i) =>
            matchStr(row.systemSku, i.sku) ||
            matchStr(row.systemSku, i.barCode) ||
            matchStr(row.systemSku, i.itemId),
        );
      }

      // 2. Try matching Barcode from Excel to DB
      if (!item && row.barcode) {
        item = dbItems.find(
          (i) =>
            matchStr(row.barcode, i.barCode) || matchStr(row.barcode, i.sku),
        );
      }

      // 3. Try matching SKU from Excel to DB
      if (!item && row.sku) {
        item = dbItems.find(
          (i) =>
            matchStr(row.sku, i.sku) ||
            matchStr(row.sku, i.barCode) ||
            matchStr(row.sku, i.itemId),
        );
      }

      // 4. Try matching partial (contains) for system SKU if still not found
      // Check stock of the initially mapped item
      let currentItemStock = -9999;
      if (item) {
        const initialStockSum = await this.prisma.stockLedger.aggregate({
          where: { itemId: item.id, locationId },
          _sum: { qty: true },
        });
        currentItemStock = Number(initialStockSum._sum?.qty ?? 0);
      }

      // 5. If STILL not found, OR it matched an item but that item has insufficient stock (e.g. it matched a junk item),
      // let's do a smart substring search on the database for the long ecommerce SKU!
      if ((!item || currentItemStock < (Number(row.qty) || 1)) && row.sku) {
        // E-commerce SKUs are often in the format BaseSKU_Color_Size
        // E.g. HJ7365-001_BLACK OR GREY_1Y
        const baseSku = row.sku.split('_')[0].trim();

        // Let's add the base SKU and also split by hyphen/space as further fallbacks
        const parts = [
          baseSku,
          ...row.sku.split(/[-_ ]+/).filter((p) => p.length >= 4),
        ];

        // Remove duplicates
        const uniqueParts = [...new Set(parts)];

        let foundBetter = false;
        for (const part of uniqueParts) {
          const fallbackItems = await this.prisma.item.findMany({
            where: {
              OR: [
                { sku: { equals: part, mode: 'insensitive' } },
                { barCode: { equals: part, mode: 'insensitive' } },
              ].filter(Boolean) as any,
              isActive: true,
            },
          });

          for (const fallbackItem of fallbackItems) {
            // Check if fallback item actually has stock
            let fbAvailable = 0;
            const fbStockSum = await this.prisma.stockLedger.aggregate({
              where: { itemId: fallbackItem.id, locationId },
              _sum: { qty: true },
            });
            fbAvailable = Number(fbStockSum._sum?.qty ?? 0);

            if (fbAvailable === 0) {
              const inv = await this.prisma.inventoryItem.findFirst({
                where: {
                  itemId: fallbackItem.id,
                  locationId,
                  status: 'AVAILABLE',
                },
              });
              fbAvailable = inv?.quantity || 0;
            }

            if (fbAvailable >= (Number(row.qty) || 1)) {
              item = fallbackItem;
              currentItemStock = fbAvailable;
              foundBetter = true;
              break;
            }
          }
          if (foundBetter) break;
        }
      }

      if (!item) {
        throw new BadRequestException(
          `Item with SKU ${row.sku} not found in inventory.`,
        );
      }

      const qty = Number(row.qty) || 1;
      let availableQty = currentItemStock;

      // If no ledger entries exist, fallback to InventoryItem
      if (availableQty === -9999 || availableQty === 0) {
        const inventory = await this.prisma.inventoryItem.findFirst({
          where: {
            itemId: item.id,
            locationId: locationId,
            status: 'AVAILABLE',
          },
        });
        if (inventory) {
          availableQty = inventory.quantity;
        } else if (availableQty === -9999) {
          availableQty = 0;
        }
      }

      if (availableQty < qty) {
        throw new BadRequestException(
          `Insufficient stock for SKU ${row.sku}. Available: ${availableQty}, Required: ${qty}`,
        );
      }

      const price = Number(row.price) || 0;

      // In the Excel file, SKU discounted and SKU actual discount are PERCENTAGES!
      // E.g. Price 8600, Paid Price 6500 => actual discount is 24.42%.
      // We should read skuActualDiscount or skuDiscounted as the percentage.
      const rawDiscountCol = row.skuActualDiscount || row.skuDiscounted;
      const discPercent = Number(rawDiscountCol) || 0;
      const discAmount = price * qty * (discPercent / 100);

      grandTotal += price * qty - discAmount;

      itemsPayload.push({
        itemId: item.id,
        quantity: qty,
        unitPrice: price,
        discountPercent: Math.min(discPercent, 100),
        taxPercent: Number((item as any).taxRate1 || 0),
      });
    }

    // We also need to add shipping as a separate line item or just let the grand total be whatever the items are.
    // For simplicity, we just use items total. If there's shipping, we might need a "shipping" item or similar.
    // We will just process the items.

    // Map payment method
    const paymentStr = orderRows[0].paymentMethod?.toLowerCase() || 'cash';
    let tenderMethod = 'cash';
    if (paymentStr.includes('card')) tenderMethod = 'card';
    if (paymentStr.includes('bank')) tenderMethod = 'bank_transfer';

    const dto: any = {
      locationId: locationId,
      posId: posId || ctxUser?.posId,
      terminalId: terminalId || ctxUser?.terminalId,
      cashierUserId: cashierUserId, // Required for order context
      notes: `Online Order: ${orderNumber}`,
      items: itemsPayload,
      tenders: [
        {
          method: tenderMethod,
          amount: grandTotal,
        },
      ],
    };

    const ctx = {
      userId: ctxUser?.id,
    };

    // Create the sales order
    const createdOrder = await this.posSalesService.createOrder(
      dto,
      cashierUserId,
      ctx,
    );

    // CRITICAL: Check if the order was actually created successfully
    // createOrder returns { status: false, message } on error instead of throwing
    if (!createdOrder.status || !createdOrder.data) {
      throw new BadRequestException(
        createdOrder.message || 'Failed to create sales order in POS'
      );
    }

    // Update the online order status to "posted" ONLY after successful POS order creation
    await this.prisma.onlineOrder.updateMany({
      where: { orderNumber },
      data: { itemStatus: 'posted' },
    });

    return {
      status: true,
      message: 'Order posted to POS successfully',
      data: createdOrder.data,
    };
  }
}
