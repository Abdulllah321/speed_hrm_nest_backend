import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { PosSalesService } from '../../pos-sales/pos-sales.service';
import { EzcommerceConfirmOrderDto } from '../dto/ezcommerce-order.dto';
import { MovementType } from '@prisma/client';
import { EncryptionService } from '../../common/utils/encryption.service';

@Injectable()

export class EzcommerceOrderService {
  private readonly logger = new Logger(EzcommerceOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaMaster: PrismaMasterService,
    private readonly encryptionService: EncryptionService,
    private readonly posSalesService: PosSalesService,
  ) {}


  async createConfirmedOrder(dto: EzcommerceConfirmOrderDto): Promise<any> {
    const activeStore = PrismaService.asyncLocalStorage.getStore();

    if (!activeStore) {
      const defaultCompany = await this.prismaMaster.company.findFirst({
        where: { status: 'active' },
        include: { tenant: true },
        orderBy: { createdAt: 'asc' },
      });

      if (defaultCompany && defaultCompany.tenant) {
        let dbUrl = defaultCompany.dbUrl || '';
        if (
          defaultCompany.dbPassword &&
          defaultCompany.dbUser &&
          defaultCompany.dbHost &&
          defaultCompany.dbName
        ) {
          try {
            const plainPassword = this.encryptionService.decrypt(
              defaultCompany.dbPassword,
            );
            const encodedPassword = encodeURIComponent(String(plainPassword));
            const port = defaultCompany.dbPort || 5432;
            dbUrl = `postgresql://${encodeURIComponent(
              defaultCompany.dbUser,
            )}:${encodedPassword}@${
              defaultCompany.dbHost
            }:${port}/${encodeURIComponent(
              defaultCompany.dbName,
            )}?schema=public&connection_limit=3&pool_timeout=15`;
          } catch (e) {
            // fallback to stored dbUrl if decryption fails
          }
        }

        return PrismaService.asyncLocalStorage.run(
          {
            tenantId: defaultCompany.tenant.id,
            companyId: defaultCompany.id,
            dbUrl,
          },
          () => this.processOrder(dto),
        );
      }
    }

    return this.processOrder(dto);
  }

  private async processOrder(dto: EzcommerceConfirmOrderDto): Promise<any> {
    const cleanCenterId = dto.center_id.trim();

    // 1. Resolve Location or Warehouse
    let locationId: string | null = null;
    let warehouseId: string | null = null;

    const location = await this.prisma.location.findFirst({
      where: {
        OR: [
          { id: cleanCenterId },
          { code: cleanCenterId },
          { shortCode: cleanCenterId },
        ],
        isDeleted: false,
      },
      select: { id: true, warehouseId: true },
    });

    if (location) {
      locationId = location.id;
      warehouseId = location.warehouseId || location.id;
    } else {
      const warehouse = await this.prisma.warehouse.findFirst({
        where: {
          OR: [{ id: cleanCenterId }, { code: cleanCenterId }],
          isDeleted: false,
        },
        select: { id: true },
      });

      if (warehouse) {
        warehouseId = warehouse.id;
      } else {
        locationId = cleanCenterId;
        warehouseId = cleanCenterId;
      }
    }


    // 2. Find or Create Customer
    const phone = dto.customer.phone.trim();
    const email = dto.customer.email?.trim();

    let customer = await this.prisma.customer.findFirst({
      where: {
        OR: [
          { contactNo: phone },
          ...(email ? [{ email }] : []),
        ],
      },
    });

    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          name: dto.customer.name.trim(),
          contactNo: phone,
          email: email || null,
          address: dto.customer.address || null,
          deliveryAddress: dto.customer.address || null,
          remarks: `Auto-created from EZCommerce Order ${dto.orderNo}`,
          customerType: 'POS',
        },
      });
      this.logger.log(
        `Created new customer ${customer.id} for EZCommerce Order ${dto.orderNo}`,
      );
    }

    // 3. Resolve Items by BarCode & Calculate Totals using ERP WOST Hierarchy
    let subtotal = 0;
    let totalDiscount = 0;
    let totalTaxAmount = 0;

    const orderItemsToCreate: Array<{
      itemId: string;
      quantity: number;
      unitPrice: number;
      discountAmount: number;
      taxPercent: number;
      taxAmount: number;
      lineTotal: number;
    }> = [];

    for (const itemDto of dto.items) {
      const barcode = itemDto.BarCode.trim();
      const itemRecord = await this.prisma.item.findFirst({
        where: {
          OR: [
            { barCode: barcode },
            { sku: barcode },
            { itemId: barcode },
          ],
          isActive: true,
        },
        select: { id: true, unitPrice: true, taxRate1: true, unitCost: true },
      });

      if (!itemRecord) {
        throw new NotFoundException(
          `Item with BarCode '${barcode}' not found or inactive`,
        );
      }

      const qty = Number(itemDto.quantity);
      const retailPrice = Number(itemDto.unitPrice || itemRecord.unitPrice || 0);
      const taxRate = Number(itemRecord.taxRate1 || 18);
      const rawDiscount = Number(itemDto.discountAmount || 0);

      // ERP WOST Calculation Hierarchy
      // 1. Calculate Unit Price Without Sales Tax (WOST)
      const wostUnit = retailPrice / (1 + taxRate / 100);
      const wostTotal = wostUnit * qty;

      // 2. Convert discount to WOST base
      const discountWOST = rawDiscount / (1 + taxRate / 100);
      const discountedBase = Math.max(0, wostTotal - discountWOST);

      // 3. Compute tax amount on discounted base
      const lineTaxAmount = discountedBase * (taxRate / 100);

      // 4. Calculate line total (discounted base + tax amount)
      const lineTotal =
        itemDto.netTotal !== undefined
          ? Number(itemDto.netTotal)
          : Math.round((discountedBase + lineTaxAmount) * 100) / 100;

      subtotal += retailPrice * qty;
      totalDiscount += rawDiscount;
      totalTaxAmount += lineTaxAmount;

      orderItemsToCreate.push({
        itemId: itemRecord.id,
        quantity: qty,
        unitPrice: retailPrice,
        discountAmount: rawDiscount,
        taxPercent: taxRate,
        taxAmount: Math.round(lineTaxAmount * 100) / 100,
        lineTotal,
      });
    }

    const shippingFee = Number(dto.shippingFee || 0);
    const grandTotal = subtotal - totalDiscount + shippingFee;

    // Check duplicate order by EZCommerce order reference in notes or order number
    const ezRefText = `EZCommerce Order ${dto.orderNo}`;
    const existingOrder = await this.prisma.salesOrder.findFirst({
      where: {
        notes: { contains: ezRefText },
      },
    });

    if (existingOrder) {
      this.logger.warn(`Order with reference ${dto.orderNo} has already been synced`);
      return {
        status: true,
        message: 'Order already synced',
        orderNumber: existingOrder.orderNumber,
        grandTotal: Number(existingOrder.grandTotal),
      };
    }

    // Generate sequential order number reusing PosSalesService generator
    const targetLocId = locationId || warehouseId || 'DEFAULT';
    const orderNumber = await this.posSalesService.generateSequentialNumber(
      'SI',
      'orderNumber',
      targetLocId,
    );

    // 4. Create Sales Order & Items with ERP Tax & Discount breakdown
    const salesOrder = await this.prisma.salesOrder.create({
      data: {
        orderNumber,
        customerId: customer.id,
        locationId,
        subtotal,
        discountAmount: totalDiscount,
        taxAmount: Math.round(totalTaxAmount * 100) / 100,
        grandTotal,
        paymentMethod: dto.paymentMethod || 'ONLINE',
        paymentStatus: dto.paymentStatus || 'paid',
        status: 'completed',
        notes: `${ezRefText} | ${dto.notes || 'Online Order'}`,
        items: {
          create: orderItemsToCreate.map((i) => ({
            itemId: i.itemId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            discountAmount: i.discountAmount,
            taxPercent: i.taxPercent,
            taxAmount: i.taxAmount,
            lineTotal: i.lineTotal,
          })),
        },
      },
      include: {
        items: true,
      },
    });



    // 5. Deduct Stock & Record Stock Ledger Movements
    for (const item of orderItemsToCreate) {
      // Find inventory item record
      const invItem = await this.prisma.inventoryItem.findFirst({
        where: {
          itemId: item.itemId,
          ...(locationId ? { locationId } : {}),
          ...(warehouseId && !locationId ? { warehouseId, locationId: null } : {}),
        },
      });

      if (invItem) {
        const newQty = Math.max(0, Number(invItem.quantity) - item.quantity);
        await this.prisma.inventoryItem.update({
          where: { id: invItem.id },
          data: { quantity: newQty },
        });
      }

      // Record Stock Ledger outbound movement
      await this.prisma.stockLedger.create({
        data: {
          itemId: item.itemId,
          locationId: locationId || undefined,
          warehouseId: warehouseId!,
          movementType: MovementType.OUTBOUND,
          qty: -item.quantity,
          referenceType: 'POS_SALE',
          referenceId: salesOrder.id,
        },
      });


    }

    this.logger.log(
      `Successfully synced order ${salesOrder.orderNumber} for customer ${customer.name}`,
    );

    return {
      status: true,
      message: 'Order confirmed and synced successfully',
      orderNumber: salesOrder.orderNumber,
      grandTotal: Number(salesOrder.grandTotal),
      itemsCount: salesOrder.items.length,
    };
  }
}
