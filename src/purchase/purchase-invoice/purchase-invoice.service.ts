import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePurchaseInvoiceDto, UpdatePurchaseInvoiceDto } from './dto';
import { AccountingService } from '../../finance/accounting/accounting.service';
import { StockLedgerService } from '../../warehouse/stock-ledger/stock-ledger.service';
import { FinanceAccountConfigService } from '../../finance/finance-account-config/finance-account-config.service';
import { AccountRoleKey } from '../../finance/finance-account-config/dto/finance-account-config.dto';
import { MovementType, Prisma } from '@prisma/client';

import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
import { generateNextJvNumber, generateNextFolioNumber } from '../../common/utils/voucher-number.util';

@Injectable()
export class PurchaseInvoiceService {
  constructor(
    private prisma: PrismaService,
    private accounting: AccountingService,
    private stockLedger: StockLedgerService,
    private financeConfig: FinanceAccountConfigService,
    private activityLogs: ActivityLogsService,
  ) {}

  async create(createDto: CreatePurchaseInvoiceDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      // Validate business rules
      await this.validateBusinessRules(createDto);

      // Calculate totals
      const { subtotal, taxAmount, advanceTaxRate, advanceTaxAmount, totalAmount } = this.calculateTotals(createDto);

      // Derive invoiceType if not explicitly provided
      const invoiceType = createDto.invoiceType
        ?? (createDto.grnId ? 'GRN_BASED' : createDto.landedCostId ? 'LANDED_COST_BASED' : 'DIRECT');

      // Resolve true UUIDs for all items to fix legacy string IDs
      const resolvedItems = await Promise.all(createDto.items.map(async (item) => {
        const itemRecord = await this.prisma.item.findFirst({
          where: {
            OR: [
              { id: item.itemId },
              { itemId: item.itemId }
            ]
          },
          select: { id: true },
        });
        return {
          ...item,
          trueItemId: itemRecord ? itemRecord.id : item.itemId
        } as any;
      }));

      const created = await this.prisma.purchaseInvoice.create({
        data: {
          invoiceNumber: createDto.invoiceNumber,
          invoiceDate: new Date(createDto.invoiceDate),
          dueDate: createDto.dueDate ? new Date(createDto.dueDate) : null,
          supplierId: createDto.supplierId,
          grnId: createDto.grnId,
          landedCostId: createDto.landedCostId,
          warehouseId: createDto.warehouseId,
          invoiceType,
          subtotal,
          taxAmount,
          advanceTaxRate,
          advanceTaxAmount,
          discountAmount: createDto.discountAmount || 0,
          totalAmount,
          remainingAmount: totalAmount,
          notes: createDto.notes,
          status: createDto.status || 'DRAFT',
          items: {
            create: resolvedItems.map((item: any) => {
              const lineTotal = item.quantity * item.unitPrice;
              const itemTaxAmount = lineTotal * (item.taxRate || 0) / 100;
              const itemDiscountAmount = lineTotal * (item.discountRate || 0) / 100;
              
              return {
                itemId: item.trueItemId,
                grnItemId: item.grnItemId,
                landedCostItemId: item.landedCostItemId,
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                lineTotal: lineTotal - itemDiscountAmount + itemTaxAmount,
                taxRate: item.taxRate || 0,
                taxAmount: itemTaxAmount,
                discountRate: item.discountRate || 0,
                discountAmount: itemDiscountAmount,
              };
            }),
          },
        },
        include: {
          supplier: true,
          grn: true,
          landedCost: true,
          items: {
            include: {
              item: true,
            },
          },
        },
      });

      runInBackground(
        'Create Purchase Invoice',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'purchase-invoice',
          entity: 'PurchaseInvoice',
          entityId: created.id,
          description: `Created purchase invoice ${created.invoiceNumber}`,
          newValues: JSON.stringify(createDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return created;
    } catch (error: any) {
      runInBackground(
        'Create Purchase Invoice (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'purchase-invoice',
          entity: 'PurchaseInvoice',
          description: 'Failed to create purchase invoice',
          errorMessage: error?.message,
          newValues: JSON.stringify(createDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async findAll(page = 1, limit = 10, filters?: any) {
    const skip = (page - 1) * limit;
    
    const where: any = {};
    if (filters?.supplierId) where.supplierId = filters.supplierId;
    if (filters?.status) where.status = filters.status;
    if (filters?.paymentStatus) where.paymentStatus = filters.paymentStatus;
    if (filters?.invoiceType) where.invoiceType = filters.invoiceType;
    
    if (filters?.search) {
      where.OR = [
        { invoiceNumber: { contains: filters.search, mode: 'insensitive' } },
        { notes: { contains: filters.search, mode: 'insensitive' } },
        { supplier: { name: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }

    const [invoices, total] = await Promise.all([
      this.prisma.purchaseInvoice.findMany({
        where,
        skip,
        take: limit,
        include: {
          supplier: true,
          grn: true,
          landedCost: true,
          items: {
          include: {
            item: true,
          },
        },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.purchaseInvoice.count({ where }),
    ]);

    return {
      data: invoices,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const invoice = await this.prisma.purchaseInvoice.findUnique({
      where: { id },
      include: {
        supplier: true,
        grn: {
          include: {
            items: {
          include: {
            item: true,
          },
        },
          },
        },
        landedCost: {
          include: {
            items: {
          include: {
            item: true,
          },
        },
          },
        },
        items: {
          include: {
            item: {
              include: {
                size: true,
                color: true,
              },
            },
          },
        },
        paymentVouchers: {
          include: {
            paymentVoucher: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundException('Purchase Invoice not found');
    }

    return invoice;
  }

  async update(id: string, updateDto: UpdatePurchaseInvoiceDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existingInvoice = await this.findOne(id);

      if (existingInvoice.status === 'APPROVED' && updateDto.status !== 'CANCELLED') {
        throw new BadRequestException('Cannot modify approved invoice');
      }

      // If updating items, advanceTaxRate, or discountAmount, recalculate totals
      let updateData: any = { ...updateDto };
      
      if (updateDto.items || updateDto.advanceTaxRate !== undefined || updateDto.discountAmount !== undefined) {
        const dtoForCalc = {
          items: updateDto.items || existingInvoice.items.map(item => ({
            itemId: item.itemId,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            taxRate: Number(item.taxRate),
            discountRate: Number(item.discountRate),
          })),
          discountAmount: updateDto.discountAmount !== undefined ? updateDto.discountAmount : Number(existingInvoice.discountAmount),
          advanceTaxRate: updateDto.advanceTaxRate !== undefined ? updateDto.advanceTaxRate : Number(existingInvoice.advanceTaxRate),
        } as CreatePurchaseInvoiceDto;

        const { subtotal, taxAmount, advanceTaxRate, advanceTaxAmount, totalAmount } = this.calculateTotals(dtoForCalc);
        updateData = {
          ...updateData,
          subtotal,
          taxAmount,
          advanceTaxRate,
          advanceTaxAmount,
          totalAmount,
          remainingAmount: totalAmount - Number(existingInvoice.paidAmount),
        };

        if (updateDto.items) {
          // Delete existing items and create new ones
          await this.prisma.purchaseInvoiceItem.deleteMany({
            where: { purchaseInvoiceId: id },
          });
        }
      }

      let finalUpdateData = { ...updateData };

      if (updateDto.items) {
        // Resolve true UUIDs for update items
        const resolvedItemsForUpdate = await Promise.all(updateDto.items.map(async (item) => {
          const itemRecord = await this.prisma.item.findFirst({
            where: {
              OR: [
                { id: item.itemId },
                { itemId: item.itemId }
              ]
            },
            select: { id: true },
          });
          return {
            ...item,
            trueItemId: itemRecord ? itemRecord.id : item.itemId
          } as any;
        }));

        finalUpdateData = {
          ...finalUpdateData,
          items: {
            create: resolvedItemsForUpdate.map((item: any) => {
              const lineTotal = item.quantity * item.unitPrice;
              const itemTaxAmount = lineTotal * (item.taxRate || 0) / 100;
              const itemDiscountAmount = lineTotal * (item.discountRate || 0) / 100;
              
              return {
                itemId: item.trueItemId,
                grnItemId: item.grnItemId,
                landedCostItemId: item.landedCostItemId,
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                lineTotal: lineTotal - itemDiscountAmount + itemTaxAmount,
                taxRate: item.taxRate || 0,
                taxAmount: itemTaxAmount,
                discountRate: item.discountRate || 0,
                discountAmount: itemDiscountAmount,
              };
            }),
          }
        };
      }

      const updated = await this.prisma.purchaseInvoice.update({
        where: { id },
        data: finalUpdateData,
        include: {
          supplier: true,
          grn: true,
          landedCost: true,
          items: {
            include: {
              item: true,
            },
          },
        },
      });

      runInBackground(
        'Update Purchase Invoice',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'purchase-invoice',
          entity: 'PurchaseInvoice',
          entityId: id,
          description: `Updated purchase invoice ${updated.invoiceNumber}`,
          newValues: JSON.stringify(updateDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return updated;
    } catch (error: any) {
      runInBackground(
        'Update Purchase Invoice (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'purchase-invoice',
          entity: 'PurchaseInvoice',
          entityId: id,
          description: 'Failed to update purchase invoice',
          errorMessage: error?.message,
          newValues: JSON.stringify(updateDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  /**
   * Delete a purchase invoice (soft delete for DRAFT invoices only)
   * Business Rules:
   * - Only DRAFT invoices can be deleted
   * - Invoices with payments cannot be deleted
   * - APPROVED invoices are protected from deletion
   */
  async remove(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const invoice = await this.findOne(id);

      // Prevent deletion of approved invoices
      if (invoice.status === 'APPROVED') {
        throw new BadRequestException('Cannot delete approved invoice');
      }

      // Prevent deletion of invoices with payments
      if (Number(invoice.paidAmount) > 0) {
        throw new BadRequestException('Cannot delete invoice with payments');
      }

      const deleted = await this.prisma.purchaseInvoice.delete({
        where: { id },
      });

      runInBackground(
        'Delete Purchase Invoice',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'purchase-invoice',
          entity: 'PurchaseInvoice',
          entityId: id,
          description: `Deleted purchase invoice ${deleted.invoiceNumber}`,
          oldValues: JSON.stringify(invoice),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return deleted;
    } catch (error: any) {
      runInBackground(
        'Delete Purchase Invoice (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'purchase-invoice',
          entity: 'PurchaseInvoice',
          entityId: id,
          description: 'Failed to delete purchase invoice',
          errorMessage: error?.message,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  // Get VALUED GRNs for invoice creation (direct flow: no Landed Cost attached)
  async getValuedGrns() {
    // Direct flow GRNs: VALUED/RECEIVED status, no Landed Cost attached
    const grns = await this.prisma.goodsReceiptNote.findMany({
      where: {
        status: {
          in: ['VALUED', 'RECEIVED', 'APPROVED'],
        },
        landedCosts: {
          none: {},
        },
      },
      include: {
        items: {
          include: {
            purchaseInvoiceItems: true,
            item: true,
          },
        },
        purchaseOrder: {
          include: {
            vendor: true,
            items: {
              include: {
                item: true,
              },
            },
          },
        },
      },
    });

    const processedGrns = grns.map(grn => ({
      ...grn,
      items: grn.items.map(item => {
        // Calculate total invoiced quantity for this GRN item
        const invoicedQty = item.purchaseInvoiceItems.reduce(
          (sum, invoiceItem) => sum + Number(invoiceItem.quantity), 
          0
        );
        const availableQty = Number(item.receivedQty) - invoicedQty;

        // Find corresponding PO item to get unit price
        const poItem = grn.purchaseOrder?.items.find(poi => poi.itemId === item.itemId);
        const unitPrice = poItem ? Number(poItem.unitPrice) : 0;

        return {
          ...item,
          availableQty: Math.max(0, availableQty), // Ensure non-negative
          unitPrice, // Add unit price from PO
          item: {
            sku: item.item.sku,
            taxRate1: item.item.taxRate1,
          },
        };
      }).filter(item => item.availableQty > 0), // Only return items with available quantity
    })).filter(grn => grn.items.length > 0); // Only return GRNs with available items

    return processedGrns;
  }

  // Get available Landed Costs for invoice creation
  async getAvailableLandedCosts() {
    const landedCosts = await this.prisma.landedCost.findMany({
      where: {
        status: {
          in: ['DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'VALUED'],
        },
        purchaseInvoices: {
          none: {
            status: {
              not: 'CANCELLED',
            },
          },
        },
      },
      include: {
        items: {
          include: {
            item: true,
          },
        },
        supplier: true,
        grn: {
          include: {
            purchaseOrder: {
              include: {
                vendor: true,
              },
            },
          },
        },
      },
    });

    // Calculate available quantities for each Landed Cost item
    const processedLandedCosts = landedCosts.map(lc => ({
      ...lc,
      items: lc.items.map(item => ({
        ...item,
        availableQty: Number(item.qty),
        item: {
          sku: item.item.sku,
          taxRate1: item.item.taxRate1,
        },
      })),
    }));

    return processedLandedCosts;
  }

  private async validateBusinessRules(createDto: CreatePurchaseInvoiceDto) {
    // Check if GRN exists and has correct status
    if (createDto.grnId) {
      const grn = await this.prisma.goodsReceiptNote.findUnique({
        where: { id: createDto.grnId },
        include: { items: true },
      });

      if (!grn) {
        throw new BadRequestException('GRN not found');
      }

      if (grn.status !== 'VALUED') {
        throw new BadRequestException('GRN must be VALUED to create invoice');
      }

      // Validate quantities against GRN items
      for (const item of createDto.items) {
        if (item.grnItemId) {
          const grnItem = grn.items.find(gi => gi.id === item.grnItemId);
          if (!grnItem) {
            throw new BadRequestException(`GRN item ${item.grnItemId} not found`);
          }

          // Check if quantity exceeds available quantity
          const existingInvoiceQty = await this.getInvoicedQuantity(item.grnItemId, 'grn');
          const availableQty = Number(grnItem.receivedQty) - existingInvoiceQty;
          
          if (item.quantity > availableQty) {
            throw new BadRequestException(
              `Invoice quantity ${item.quantity} exceeds available quantity ${availableQty} for item ${item.itemId}`
            );
          }
        }
      }
    }

    // Check if Landed Cost exists and validate
    if (createDto.landedCostId) {
      const landedCost = await this.prisma.landedCost.findUnique({
        where: { id: createDto.landedCostId },
        include: { items: true },
      });

      if (!landedCost) {
        throw new BadRequestException('Landed Cost not found');
      }

      if (!landedCost.status || !['DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'VALUED'].includes(landedCost.status)) {
        throw new BadRequestException('Landed Cost must have a valid status to create invoice');
      }

      // Validate quantities against Landed Cost items
      for (const item of createDto.items) {
        if (item.landedCostItemId) {
          const lcItem = landedCost.items.find(lci => lci.id === item.landedCostItemId);
          if (!lcItem) {
            throw new BadRequestException(`Landed Cost item ${item.landedCostItemId} not found`);
          }

          const existingInvoiceQty = await this.getInvoicedQuantity(item.landedCostItemId, 'landedCost');
          const availableQty = Number(lcItem.qty) - existingInvoiceQty;
          
          if (item.quantity > availableQty) {
            throw new BadRequestException(
              `Invoice quantity ${item.quantity} exceeds available quantity ${availableQty} for item ${item.itemId}`
            );
          }
        }
      }
    }

    // For DIRECT invoices — validate each item exists in master
    const isDirect = !createDto.grnId && !createDto.landedCostId;
    if (isDirect) {
      if (!createDto.warehouseId) {
        throw new BadRequestException('warehouseId is required for Direct Purchase Invoices');
      }
      const warehouse = await this.prisma.warehouse.findUnique({
        where: { id: createDto.warehouseId },
        select: { id: true },
      });
      if (!warehouse) {
        throw new BadRequestException('Warehouse not found');
      }
      for (const item of createDto.items) {
        const exists = await this.prisma.item.findFirst({
          where: { OR: [{ id: item.itemId }, { itemId: item.itemId }] },
          select: { id: true },
        });
        if (!exists) {
          throw new BadRequestException(`Item ${item.itemId} not found in master`);
        }
        if (item.quantity <= 0) {
          throw new BadRequestException(`Quantity must be greater than 0 for item ${item.itemId}`);
        }
        if (item.unitPrice <= 0) {
          throw new BadRequestException(`Unit price must be greater than 0 for item ${item.itemId}`);
        }
      }
    }

    // Check for duplicate invoice number
    const existingInvoice = await this.prisma.purchaseInvoice.findUnique({
      where: { invoiceNumber: createDto.invoiceNumber },
    });

    if (existingInvoice) {
      throw new BadRequestException('Invoice number already exists');
    }
  }

  private async getInvoicedQuantity(itemId: string, type: 'grn' | 'landedCost'): Promise<number> {
    const whereClause = type === 'grn' 
      ? { grnItemId: itemId }
      : { landedCostItemId: itemId };

    const result = await this.prisma.purchaseInvoiceItem.aggregate({
      where: whereClause,
      _sum: { quantity: true },
    });

    return Number(result._sum.quantity) || 0;
  }

  private calculateTotals(dto: CreatePurchaseInvoiceDto | UpdatePurchaseInvoiceDto, existingAdvanceTaxRate?: number) {
    let subtotal = 0;
    let taxAmount = 0;

    const items = dto.items || [];
    for (const item of items) {
      const lineTotal = item.quantity * item.unitPrice;
      const itemDiscountAmount = lineTotal * (item.discountRate || 0) / 100;
      const discountedAmount = lineTotal - itemDiscountAmount;
      const itemTaxAmount = discountedAmount * (item.taxRate || 0) / 100;

      subtotal = subtotal + discountedAmount;
      taxAmount = taxAmount + itemTaxAmount;
    }

    const totalDiscountAmount = dto.discountAmount !== undefined ? dto.discountAmount : 0;
    const baseTotal = subtotal + taxAmount - totalDiscountAmount;

    let advanceTaxRate = 0.5;
    if (dto.advanceTaxRate !== undefined && dto.advanceTaxRate !== null) {
      advanceTaxRate = dto.advanceTaxRate;
    } else if (existingAdvanceTaxRate !== undefined && existingAdvanceTaxRate !== null) {
      advanceTaxRate = existingAdvanceTaxRate;
    }
    const advanceTaxAmount = baseTotal * advanceTaxRate / 100;

    const totalAmount = baseTotal + advanceTaxAmount;

    return {
      subtotal,
      taxAmount,
      advanceTaxRate,
      advanceTaxAmount,
      totalAmount,
    };
  }

  async getNextInvoiceNumber(): Promise<{ nextInvoiceNumber: string }> {
    const currentYear = new Date().getFullYear();
    const prefix = 'PI';
    
    const lastInvoice = await this.prisma.purchaseInvoice.findFirst({
      where: {
        invoiceNumber: {
          startsWith: `${prefix}-${currentYear}`,
        },
      },
      orderBy: {
        invoiceNumber: 'desc',
      },
    });

    let nextNumber = 1;
    if (lastInvoice) {
      const lastNumber = parseInt(lastInvoice.invoiceNumber.split('-').pop() || '0');
      nextNumber = lastNumber + 1;
    }

    const nextInvoiceNumber = `${prefix}-${currentYear}-${nextNumber.toString().padStart(4, '0')}`;
    return { nextInvoiceNumber };
  }

  async getSummary(supplierId?: string) {
    const where = supplierId ? { supplierId } : {};
    
    const [
      totalInvoices,
      draftInvoices,
      approvedInvoices,
      totalAmount,
      paidAmount,
      pendingAmount,
    ] = await Promise.all([
      this.prisma.purchaseInvoice.count({ where }),
      this.prisma.purchaseInvoice.count({ where: { ...where, status: 'DRAFT' } }),
      this.prisma.purchaseInvoice.count({ where: { ...where, status: 'APPROVED' } }),
      this.prisma.purchaseInvoice.aggregate({
        where,
        _sum: { totalAmount: true },
      }),
      this.prisma.purchaseInvoice.aggregate({
        where,
        _sum: { paidAmount: true },
      }),
      this.prisma.purchaseInvoice.aggregate({
        where,
        _sum: { remainingAmount: true },
      }),
    ]);

    return {
      totalInvoices,
      draftInvoices,
      approvedInvoices,
      totalAmount: totalAmount._sum.totalAmount || 0,
      paidAmount: paidAmount._sum.paidAmount || 0,
      pendingAmount: pendingAmount._sum.remainingAmount || 0,
    };
  }

  async approve(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const invoice = await this.findOne(id);

      if (invoice.status === 'APPROVED' || invoice.status === 'CANCELLED') {
        throw new BadRequestException('Invoice is already approved or cancelled');
      }

      // Fetch supplier with linked payable accounts
      const supplier = await this.prisma.supplier.findUnique({
        where: { id: invoice.supplierId },
        include: { chartOfAccounts: { select: { id: true } } },
      });

      if (!supplier) {
        throw new BadRequestException('Supplier not found for this purchase invoice.');
      }

      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.purchaseInvoice.update({
          where: { id },
          data: { status: 'APPROVED' },
          include: { supplier: true, grn: true, landedCost: true, items: true },
        });

        const totalAmount = Number(invoice.totalAmount);

        // Resolve local purchases account if configured
        let purchasesAccountId: string | null = null;
        try {
          purchasesAccountId = await this.financeConfig.resolveAccount(
            AccountRoleKey.PURCHASES_LOCAL,
          );
        } catch (error) {
          // Gracefully ignore if not configured
        }

        let apPartiesAccountId: string | null = null;
        try {
          apPartiesAccountId = await this.financeConfig.resolveAccount(
            AccountRoleKey.AP_PARTIES,
          );
        } catch (error) {
          // Gracefully ignore if not configured
        }

        let payableAccounts: { accountId: string; tagAccountId?: string }[] = [];

        if (apPartiesAccountId && supplier) {
          const tagAccount = await tx.chartOfAccount.findFirst({
            where: {
              parentId: apPartiesAccountId,
              code: supplier.code,
            },
            select: { id: true },
          });
          if (tagAccount) {
            payableAccounts.push({
              accountId: apPartiesAccountId,
              tagAccountId: tagAccount.id,
            });
          } else {
            throw new BadRequestException(
              `Tag account with code "${supplier.code}" not found under the configured Accounts Payable Parties account.`,
            );
          }
        } else if (supplier?.chartOfAccounts?.length) {
          payableAccounts = supplier.chartOfAccounts.map(acc => ({
            accountId: acc.id,
          }));
        }

        if (supplier?.type === 'IMPORT') {
          // Build and post journal lines only if finance configuration is present
          if (purchasesAccountId && payableAccounts.length > 0) {
            const creditPerAccount = totalAmount / payableAccounts.length;
            const creditLines = payableAccounts.map(acc => ({
              accountId: acc.accountId,
              tagAccountId: acc.tagAccountId,
              debit: 0,
              credit: creditPerAccount,
            }));

            const debitLines = [{ accountId: purchasesAccountId, debit: totalAmount, credit: 0 }];

            await this.accounting.postLines([...debitLines, ...creditLines], {
              sourceType: 'PURCHASE_INVOICE',
              sourceId: id,
              sourceRef: invoice.invoiceNumber,
              description: `Purchase Invoice approved: ${invoice.invoiceNumber}`,
              transactionDate: new Date(),
            }, tx);
          }
        } else {
          // Generate auto draft Journal Voucher for LOCAL purchase
          const jvDate = new Date();
          const sequentialJvNo = await generateNextJvNumber(tx, jvDate);
          const sequentialFolio = await generateNextFolioNumber(tx, jvDate);

          const itemsWithBrand = await tx.purchaseInvoiceItem.findMany({
            where: { purchaseInvoiceId: id },
            include: {
              item: {
                include: {
                  brand: true
                }
              }
            }
          });

          const brandGroups: { [brandName: string]: { quantity: number; lineTotalExclTax: number } } = {};
          for (const item of itemsWithBrand) {
            const brandName = item.item.brand?.name || 'Unknown';
            if (!brandGroups[brandName]) {
              brandGroups[brandName] = { quantity: 0, lineTotalExclTax: 0 };
            }
            const qty = Number(item.quantity);
            const price = Number(item.unitPrice);
            const discount = Number(item.discountAmount || 0);
            brandGroups[brandName].quantity += qty;
            brandGroups[brandName].lineTotalExclTax += (qty * price - discount);
          }

          const detailsData: any[] = [];
          const roundToTwo = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100;
          const totalQuantity = itemsWithBrand.reduce((sum, item) => sum + Number(item.quantity), 0);
          const brandListStr = Object.keys(brandGroups).join(' & ');

          // 1. Debit lines for purchases (60020002) grouped by brand
          const purchasesParent = await tx.chartOfAccount.findFirst({
            where: { code: '60020002' }
          });
          if (!purchasesParent) {
            throw new BadRequestException('Purchases Local account (60020002) not found in Chart of Accounts.');
          }

          for (const [brandName, group] of Object.entries(brandGroups)) {
            const tagAccount = await tx.chartOfAccount.findFirst({
              where: {
                parentId: purchasesParent.id,
                name: { equals: brandName, mode: 'insensitive' }
              }
            });
            if (!tagAccount) {
              throw new BadRequestException(`Tag account for brand "${brandName}" not found under Purchases Local account (60020002).`);
            }

            let brandDebitValue = group.lineTotalExclTax;
            if (Number(invoice.discountAmount) > 0 && Number(invoice.subtotal) > 0) {
              brandDebitValue = brandDebitValue - (brandDebitValue / Number(invoice.subtotal)) * Number(invoice.discountAmount);
            }

            detailsData.push({
              accountId: purchasesParent.id,
              tagAccountId: tagAccount.id,
              debit: roundToTwo(brandDebitValue),
              credit: 0,
              narration: `REC ${group.quantity} Pcs. of ${brandName} Shipment. ref 1 is ${invoice.invoiceNumber} ref 2 is ${invoice.grn?.grnNumber || ''}`,
              refBillNo: invoice.invoiceNumber,
              refBillNo2: invoice.grn?.grnNumber || '',
              taxType: 'Taxable',
            });
          }

          // 2. Sales tax line (31070003) - Debit
          if (Number(invoice.taxAmount) > 0) {
            const taxParent = await tx.chartOfAccount.findFirst({
              where: { code: '31070003' }
            });
            if (!taxParent) {
              throw new BadRequestException('Sales Tax account (31070003) not found in Chart of Accounts.');
            }

            const tagAccount = await tx.chartOfAccount.findFirst({
              where: {
                parentId: taxParent.id,
                code: supplier.code
              }
            });
            if (!tagAccount) {
              throw new BadRequestException(`Tag account with code "${supplier.code}" not found under Sales Tax account (31070003).`);
            }

            detailsData.push({
              accountId: taxParent.id,
              tagAccountId: tagAccount.id,
              debit: roundToTwo(Number(invoice.taxAmount)),
              credit: 0,
              narration: `REC Sales Tax for ${totalQuantity} Pcs. of ${brandListStr} Shipment. ref 1 is ${invoice.invoiceNumber} ref 2 is ${invoice.grn?.grnNumber || ''}`,
              refBillNo: invoice.invoiceNumber,
              refBillNo2: invoice.grn?.grnNumber || '',
              taxType: 'Taxable',
            });
          }

          // 3. Advance tax line (31080002) - Debit
          if (Number(invoice.advanceTaxAmount) > 0) {
            const advTaxParent = await tx.chartOfAccount.findFirst({
              where: { code: '31080002' }
            });
            if (!advTaxParent) {
              throw new BadRequestException('Advance Tax account (31080002) not found in Chart of Accounts.');
            }

            const tagAccount = await tx.chartOfAccount.findFirst({
              where: {
                parentId: advTaxParent.id,
                code: supplier.code
              }
            });
            if (!tagAccount) {
              throw new BadRequestException(`Tag account with code "${supplier.code}" not found under Advance Tax account (31080002).`);
            }

            detailsData.push({
              accountId: advTaxParent.id,
              tagAccountId: tagAccount.id,
              debit: roundToTwo(Number(invoice.advanceTaxAmount)),
              credit: 0,
              narration: `REC Advance Tax for ${totalQuantity} Pcs. of ${brandListStr} Shipment. ref 1 is ${invoice.invoiceNumber} ref 2 is ${invoice.grn?.grnNumber || ''}`,
              refBillNo: invoice.invoiceNumber,
              refBillNo2: invoice.grn?.grnNumber || '',
              taxType: 'Taxable',
            });
          }

          // 4. Bills payable line (12010004) - Credit
          const billsPayableParent = await tx.chartOfAccount.findFirst({
            where: { code: '12010004' }
          });
          if (!billsPayableParent) {
            throw new BadRequestException('Bills Payable-Local account (12010004) not found in Chart of Accounts.');
          }

          const bpTagAccount = await tx.chartOfAccount.findFirst({
            where: {
              parentId: billsPayableParent.id,
              code: supplier.code
            }
          });
          if (!bpTagAccount) {
            throw new BadRequestException(`Tag account with code "${supplier.code}" not found under Bills Payable-Local account (12010004).`);
          }

          const valueInclSalesTax = Number(invoice.subtotal) + Number(invoice.taxAmount) - Number(invoice.discountAmount);
          detailsData.push({
            accountId: billsPayableParent.id,
            tagAccountId: bpTagAccount.id,
            debit: 0,
            credit: roundToTwo(valueInclSalesTax),
            narration: `REC ${totalQuantity} Pcs. of ${brandListStr} Shipment. ref 1 is ${invoice.invoiceNumber} ref 2 is ${invoice.grn?.grnNumber || ''}`,
            refBillNo: invoice.invoiceNumber,
            refBillNo2: invoice.grn?.grnNumber || '',
            taxType: 'Taxable',
          });

          // 5. Bills payable advance tax line (12010004) - Credit
          if (Number(invoice.advanceTaxAmount) > 0) {
            detailsData.push({
              accountId: billsPayableParent.id,
              tagAccountId: bpTagAccount.id,
              debit: 0,
              credit: roundToTwo(Number(invoice.advanceTaxAmount)),
              narration: `REC Advance Tax for ${totalQuantity} Pcs. of ${brandListStr} Shipment. ref 1 is ${invoice.invoiceNumber} ref 2 is ${invoice.grn?.grnNumber || ''}`,
              refBillNo: invoice.invoiceNumber,
              refBillNo2: invoice.grn?.grnNumber || '',
              taxType: 'Taxable',
            });
          }

          // Balanced check correction
          let totalDebitSum = 0;
          let totalCreditSum = 0;
          for (const line of detailsData) {
            totalDebitSum += line.debit;
            totalCreditSum += line.credit;
          }

          const diff = roundToTwo(totalCreditSum - totalDebitSum);
          if (Math.abs(diff) > 0 && detailsData.length > 0) {
            const firstPurchaseLine = detailsData.find(d => d.accountId === purchasesParent.id);
            if (firstPurchaseLine) {
              firstPurchaseLine.debit = roundToTwo(firstPurchaseLine.debit + diff);
            }
          }

          // Create the draft Journal Voucher
          await tx.journalVoucher.create({
            data: {
              jvNo: sequentialJvNo,
              folio: sequentialFolio,
              jvDate: jvDate,
              description: `Auto Generated JV from Approved Purchase Invoice ${invoice.invoiceNumber}`,
              status: 'pending', // Draft
              details: {
                create: detailsData.map(d => ({
                  accountId: d.accountId,
                  tagAccountId: d.tagAccountId,
                  debit: d.debit,
                  credit: d.credit,
                  narration: d.narration,
                  refBillNo: d.refBillNo,
                  refBillNo2: d.refBillNo2,
                  taxType: d.taxType,
                })),
              },
            },
          });
        }

        // ── Write supplier ledger credit entry ───────────────────────────────
        const supplierForLedger = await tx.supplier.findUnique({
          where: { id: invoice.supplierId },
          select: { currentBalance: true, advanceBalance: true },
        });
        if (supplierForLedger) {
          const newBalance = Number(supplierForLedger.currentBalance) + totalAmount;
          await tx.supplierLedger.create({
            data: {
              supplierId: invoice.supplierId,
              entryDate: new Date(),
              entryType: 'PURCHASE_INVOICE',
              sourceId: id,
              sourceRef: invoice.invoiceNumber,
              description: `Purchase Invoice approved`,
              debit: 0,
              credit: totalAmount,
              balanceAfter: newBalance,
              advanceDebit: 0,
              advanceCredit: 0,
              advanceBalance: Number(supplierForLedger.advanceBalance),
            },
          });
          await tx.supplier.update({
            where: { id: invoice.supplierId },
            data: { currentBalance: newBalance },
          });
        }

        // ── DIRECT invoice: update warehouse inventory on approval ────────────
        if ((invoice as any).invoiceType === 'DIRECT' && (invoice as any).warehouseId) {
          const warehouseId = (invoice as any).warehouseId as string;
          for (const item of invoice.items) {
            const qty = new Prisma.Decimal(item.quantity);
            const unitPrice = new Prisma.Decimal(item.unitPrice);

            // Stock ledger entry (INBOUND)
            await this.stockLedger.createEntry(
              {
                itemId: item.itemId,
                warehouseId,
                qty: qty.toNumber(),
                movementType: MovementType.INBOUND,
                referenceType: 'PURCHASE_INVOICE',
                referenceId: id,
                rate: unitPrice,
              },
              tx,
            );

            // Upsert InventoryItem (warehouse stock)
            const existing = await tx.inventoryItem.findFirst({
              where: { warehouseId, locationId: null, itemId: item.itemId, status: 'AVAILABLE' },
            });
            if (existing) {
              await tx.inventoryItem.update({
                where: { id: existing.id },
                data: { quantity: { increment: qty } },
              });
            } else {
              await tx.inventoryItem.create({
                data: { warehouseId, locationId: null, itemId: item.itemId, quantity: qty, status: 'AVAILABLE' },
              });
            }
          }
        }

        runInBackground(
          'Approve Purchase Invoice',
          this.activityLogs.log({
            userId: ctx?.userId,
            action: 'update',
            module: 'purchase-invoice',
            entity: 'PurchaseInvoice',
            entityId: id,
            description: `Approved purchase invoice ${updated.invoiceNumber}`,
            newValues: JSON.stringify({ status: 'APPROVED' }),
            ipAddress: ctx?.ipAddress,
            userAgent: ctx?.userAgent,
            status: 'success',
          }),
        );

        return updated;
      });
    } catch (error: any) {
      runInBackground(
        'Approve Purchase Invoice (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'purchase-invoice',
          entity: 'PurchaseInvoice',
          entityId: id,
          description: 'Failed to approve purchase invoice',
          errorMessage: error?.message,
          newValues: JSON.stringify({ status: 'APPROVED' }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async cancel(id: string, reason?: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const invoice = await this.findOne(id);

      if (invoice.status === 'CANCELLED') {
        throw new BadRequestException('Invoice is already cancelled');
      }

      if (Number(invoice.paidAmount) > 0) {
        throw new BadRequestException('Cannot cancel invoice with payments');
      }

      return this.prisma.$transaction(async (tx) => {
        // If invoice was approved, reverse the journal entries
        if (invoice.status === 'APPROVED') {
          const supplier = await tx.supplier.findUnique({
            where: { id: invoice.supplierId },
            include: { chartOfAccounts: { select: { id: true } } },
          });

          if (!supplier) {
            throw new BadRequestException('Supplier not found for this purchase invoice.');
          }

          let purchasesAccount: string | null = null;
          try {
            purchasesAccount = await this.financeConfig.resolveAccount(
              AccountRoleKey.PURCHASES_LOCAL,
            );
          } catch (error) {
            // Gracefully ignore if not configured
          }

          let apPartiesAccountId: string | null = null;
          try {
            apPartiesAccountId = await this.financeConfig.resolveAccount(
              AccountRoleKey.AP_PARTIES,
            );
          } catch (error) {
            // Gracefully ignore if not configured
          }

          let payableAccounts: { accountId: string; tagAccountId?: string }[] = [];

          if (apPartiesAccountId && supplier) {
            const tagAccount = await tx.chartOfAccount.findFirst({
              where: {
                parentId: apPartiesAccountId,
                code: supplier.code,
              },
              select: { id: true },
            });
            if (tagAccount) {
              payableAccounts.push({
                accountId: apPartiesAccountId,
                tagAccountId: tagAccount.id,
              });
            } else {
              throw new BadRequestException(
                `Tag account with code "${supplier.code}" not found under the configured Accounts Payable Parties account.`,
              );
            }
          } else if (supplier?.chartOfAccounts?.length) {
            payableAccounts = supplier.chartOfAccounts.map(acc => ({
              accountId: acc.id,
            }));
          }

          if (supplier?.type === 'IMPORT') {
            if (purchasesAccount && payableAccounts.length > 0) {
              const totalAmount = Number(invoice.totalAmount);
              const creditPerAccount = totalAmount / payableAccounts.length;

              const originalLines = [
                { accountId: purchasesAccount, debit: totalAmount, credit: 0 },
                ...payableAccounts.map(acc => ({
                  accountId: acc.accountId,
                  tagAccountId: acc.tagAccountId,
                  debit: 0,
                  credit: creditPerAccount,
                })),
              ];

              await this.accounting.reverseLines(originalLines, {
                sourceType: 'PURCHASE_INVOICE',
                sourceId: id,
                sourceRef: invoice.invoiceNumber,
                description: `Purchase Invoice cancelled: ${invoice.invoiceNumber}`,
                transactionDate: new Date(),
              }, tx);
            }
          }

          // ── DIRECT invoice: reverse warehouse inventory on cancellation ──────
          if ((invoice as any).invoiceType === 'DIRECT' && (invoice as any).warehouseId) {
            const warehouseId = (invoice as any).warehouseId as string;
            for (const item of invoice.items) {
              const qty = new Prisma.Decimal(item.quantity).negated();

              // OUTBOUND ledger entry to reverse the INBOUND
              await this.stockLedger.createEntry(
                {
                  itemId: item.itemId,
                  warehouseId,
                  qty: qty.toNumber(),
                  movementType: MovementType.OUTBOUND,
                  referenceType: 'PURCHASE_INVOICE_CANCEL',
                  referenceId: id,
                },
                tx,
              );

              // Decrement InventoryItem
              const existing = await tx.inventoryItem.findFirst({
                where: { warehouseId, locationId: null, itemId: item.itemId, status: 'AVAILABLE' },
              });
              if (existing) {
                await tx.inventoryItem.update({
                  where: { id: existing.id },
                  data: { quantity: { decrement: new Prisma.Decimal(item.quantity) } },
                });
              }
            }
          }
        }

        const updated = await tx.purchaseInvoice.update({
          where: { id },
          data: {
            status: 'CANCELLED',
            ...(reason && { notes: `${invoice.notes || ''}\nCancellation Reason: ${reason}` }),
          },
          include: { supplier: true, grn: true, landedCost: true, items: true },
        });

        runInBackground(
          'Cancel Purchase Invoice',
          this.activityLogs.log({
            userId: ctx?.userId,
            action: 'update',
            module: 'purchase-invoice',
            entity: 'PurchaseInvoice',
            entityId: id,
            description: `Cancelled purchase invoice ${invoice.invoiceNumber}. Reason: ${reason || 'N/A'}`,
            newValues: JSON.stringify({ status: 'CANCELLED', cancellationReason: reason }),
            ipAddress: ctx?.ipAddress,
            userAgent: ctx?.userAgent,
            status: 'success',
          }),
        );

        return updated;
      });
    } catch (error: any) {
      runInBackground(
        'Cancel Purchase Invoice (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'purchase-invoice',
          entity: 'PurchaseInvoice',
          entityId: id,
          description: `Failed to cancel purchase invoice. Reason: ${reason || 'N/A'}`,
          errorMessage: error?.message,
          newValues: JSON.stringify({ status: 'CANCELLED', cancellationReason: reason }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }
  
}