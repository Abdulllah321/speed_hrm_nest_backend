import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSalesReturnDto, SalesReturnSourceType } from './dto/create-sales-return.dto';
import { UpdateSalesReturnDto } from './dto/update-sales-return.dto';
import { FinanceAccountConfigService } from '../../finance/finance-account-config/finance-account-config.service';
import { AccountingService } from '../../finance/accounting/accounting.service';
import { AccountRoleKey } from '../../finance/finance-account-config/dto/finance-account-config.dto';
import { JournalVoucherService } from '../../finance/journal-voucher/journal-voucher.service';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';

@Injectable()
export class SalesReturnService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
    private financeConfig: FinanceAccountConfigService,
    private accounting: AccountingService,
    private readonly journalVoucherService: JournalVoucherService,
  ) {}

  async create(createDto: CreateSalesReturnDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      await this.validateSourceDocument(createDto);

      const { nextReturnNumber } = await this.getNextReturnNumber();
      const returnNumber = nextReturnNumber;

      const { subtotal, taxAmount, totalAmount } = this.calculateTotals(createDto);

      const created = await this.prisma.salesReturn.create({
        data: {
          returnNumber,
          sourceType: createDto.sourceType,
          deliveryChallanId: createDto.deliveryChallanId,
          salesInvoiceId: createDto.salesInvoiceId,
          customerId: createDto.customerId,
          warehouseId: createDto.warehouseId,
          returnType: createDto.returnType || 'DEFECTIVE',
          reason: createDto.reason,
          notes: createDto.notes,
          staxEInvoiceNumber: createDto.staxEInvoiceNumber,
          subtotal,
          taxAmount,
          totalAmount,
          items: {
            create: createDto.items.map(item => ({
              sourceItemType: item.sourceItemType,
              deliveryChallanItemId: item.deliveryChallanItemId,
              salesInvoiceItemId: item.salesInvoiceItemId,
              itemId: item.itemId,
              description: item.description,
              returnQty: item.returnQty,
              unitPrice: item.unitPrice,
              lineTotal: item.lineTotal,
              reason: item.reason,
            })),
          },
        },
        include: {
          items: true,
          salesInvoice: true,
          deliveryChallan: true,
          customer: true,
          warehouse: true,
        },
      });

      runInBackground(
        'Create Sales Return',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'sales-return',
          entity: 'SalesReturn',
          entityId: created.id,
          description: `Created sales return ${created.returnNumber}`,
          newValues: JSON.stringify(createDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return created;
    } catch (error: any) {
      runInBackground(
        'Create Sales Return (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'sales-return',
          entity: 'SalesReturn',
          description: 'Failed to create sales return',
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

  async findAll(status?: string) {
    return this.prisma.salesReturn.findMany({
      where: status && status !== 'ALL' ? { status } : {},
      include: {
        items: {
          include: {
            item: {
              include: {
                brand: true,
              },
            },
          },
        },
        salesInvoice: {
          include: {
            deliveryChallan: true,
          },
        },
        deliveryChallan: true,
        customer: true,
        warehouse: true,
        creditNote: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const salesReturn = await this.prisma.salesReturn.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            deliveryChallanItem: true,
            salesInvoiceItem: true,
            item: {
              include: {
                size: true,
                color: true,
                brand: true,
              },
            },
          },
        },
        salesInvoice: {
          include: {
            salesOrder: true,
            deliveryChallan: true,
          },
        },
        deliveryChallan: {
          include: {
            salesOrder: true,
          },
        },
        creditNote: true,
        customer: true,
        warehouse: true,
      },
    });

    if (!salesReturn) {
      throw new NotFoundException('Sales return not found');
    }

    return salesReturn;
  }

  async update(id: string, updateDto: UpdateSalesReturnDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existingReturn = await this.findOne(id);

      if (existingReturn.status !== 'DRAFT') {
        throw new BadRequestException('Only DRAFT returns can be updated');
      }

      const { subtotal, taxAmount, totalAmount } = this.calculateTotals(updateDto);

      const updateData: any = {
        subtotal,
        taxAmount,
        totalAmount,
      };

      if (updateDto.returnType) updateData.returnType = updateDto.returnType;
      if (updateDto.warehouseId) updateData.warehouseId = updateDto.warehouseId;
      if (updateDto.reason !== undefined) updateData.reason = updateDto.reason;
      if (updateDto.notes !== undefined) updateData.notes = updateDto.notes;
      if (updateDto.staxEInvoiceNumber !== undefined) updateData.staxEInvoiceNumber = updateDto.staxEInvoiceNumber;

      if (updateDto.items && updateDto.items.length > 0) {
        updateData.items = {
          deleteMany: {},
          create: updateDto.items.map(item => ({
            sourceItemType: item.sourceItemType,
            deliveryChallanItemId: item.deliveryChallanItemId,
            salesInvoiceItemId: item.salesInvoiceItemId,
            itemId: item.itemId,
            description: item.description,
            returnQty: item.returnQty,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
            reason: item.reason,
          })),
        };
      }

      const updated = await this.prisma.salesReturn.update({
        where: { id },
        data: updateData,
        include: {
          items: true,
          salesInvoice: true,
          deliveryChallan: true,
          customer: true,
          warehouse: true,
        },
      });

      runInBackground(
        'Update Sales Return',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-return',
          entity: 'SalesReturn',
          entityId: id,
          description: `Updated sales return ${updated.returnNumber}`,
          newValues: JSON.stringify(updateDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return updated;
    } catch (error: any) {
      runInBackground(
        'Update Sales Return (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-return',
          entity: 'SalesReturn',
          entityId: id,
          description: 'Failed to update sales return',
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

  async updateStatus(id: string, status: string, approvedBy?: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const salesReturn = await this.findOne(id);

      if (status === 'APPROVED' && salesReturn.status === 'SUBMITTED') {
        // 1. Process inventory adjustment (Increase warehouse stock)
        await this.processInventoryAdjustment(salesReturn);

        // 2. Process financial adjustment (Credit Note + Customer balance update)
        await this.processFinancialAdjustment(salesReturn);

        // 3. Auto-generate draft Journal Voucher
        try {
          await this.autoGenerateJournalVoucher(salesReturn, ctx);
        } catch (jvError) {
          console.error('Failed to auto-generate Journal Voucher for Sales Return:', jvError);
        }
      }

      const updated = await this.prisma.salesReturn.update({
        where: { id },
        data: {
          status,
          approvedBy: status === 'APPROVED' ? approvedBy : salesReturn.approvedBy,
          approvedAt: status === 'APPROVED' ? new Date() : salesReturn.approvedAt,
        },
      });

      runInBackground(
        'Update Sales Return Status',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-return',
          entity: 'SalesReturn',
          entityId: id,
          description: `Updated sales return status to ${status} for ${updated.returnNumber}`,
          newValues: JSON.stringify({ status }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return updated;
    } catch (error: any) {
      runInBackground(
        'Update Sales Return Status (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-return',
          entity: 'SalesReturn',
          entityId: id,
          description: `Failed to update sales return status to ${status}`,
          errorMessage: error?.message,
          newValues: JSON.stringify({ status }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async remove(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const salesReturn = await this.findOne(id);

      if (salesReturn.status !== 'DRAFT') {
        throw new BadRequestException('Only DRAFT returns can be deleted');
      }

      const deleted = await this.prisma.salesReturn.delete({
        where: { id },
      });

      runInBackground(
        'Delete Sales Return',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'sales-return',
          entity: 'SalesReturn',
          entityId: id,
          description: `Deleted sales return ${salesReturn.returnNumber}`,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return deleted;
    } catch (error: any) {
      runInBackground(
        'Delete Sales Return (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'sales-return',
          entity: 'SalesReturn',
          entityId: id,
          description: 'Failed to delete sales return',
          errorMessage: error?.message,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async getEligibleInvoices() {
    return this.prisma.eRPSalesInvoice.findMany({
      include: {
        customer: true,
        warehouse: true,
        deliveryChallan: true,
        items: {
          include: {
            item: {
              include: {
                size: true,
                color: true,
                brand: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getEligibleChallans() {
    return this.prisma.deliveryChallan.findMany({
      include: {
        customer: true,
        warehouse: true,
        items: {
          include: {
            item: {
              include: {
                size: true,
                color: true,
                brand: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getNextReturnNumber() {
    const lastReturn = await this.prisma.salesReturn.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { returnNumber: true },
    });

    if (!lastReturn || !lastReturn.returnNumber) {
      return { nextReturnNumber: 'SR-00001' };
    }

    const match = lastReturn.returnNumber.match(/SR-(\d+)/);
    if (match) {
      const nextNum = parseInt(match[1], 10) + 1;
      return { nextReturnNumber: `SR-${nextNum.toString().padStart(5, '0')}` };
    }

    return { nextReturnNumber: `SR-${Date.now()}` };
  }

  private async validateSourceDocument(createDto: CreateSalesReturnDto) {
    if (createDto.sourceType === SalesReturnSourceType.INVOICE) {
      if (!createDto.salesInvoiceId) {
        throw new BadRequestException('Sales Invoice ID is required for INVOICE return');
      }
      const invoice = await this.prisma.eRPSalesInvoice.findUnique({
        where: { id: createDto.salesInvoiceId },
      });
      if (!invoice) {
        throw new NotFoundException('Sales Invoice not found');
      }
    } else if (createDto.sourceType === SalesReturnSourceType.DELIVERY_CHALLAN) {
      if (!createDto.deliveryChallanId) {
        throw new BadRequestException('Delivery Challan ID is required for DELIVERY_CHALLAN return');
      }
      const dc = await this.prisma.deliveryChallan.findUnique({
        where: { id: createDto.deliveryChallanId },
      });
      if (!dc) {
        throw new NotFoundException('Delivery Challan not found');
      }
    }
  }

  private calculateTotals(dto: Partial<CreateSalesReturnDto>) {
    let subtotal = 0;
    let taxAmount = 0;
    let totalAmount = 0;

    if (dto.items && dto.items.length > 0) {
      for (const item of dto.items) {
        const lineTotal = Number(item.lineTotal || 0);
        subtotal += lineTotal;
        totalAmount += lineTotal;
      }
    }

    return {
      subtotal: Math.round(subtotal * 100) / 100,
      taxAmount: Math.round(taxAmount * 100) / 100,
      totalAmount: Math.round(totalAmount * 100) / 100,
    };
  }

  private async processInventoryAdjustment(salesReturn: any) {
    const stockLedgerExists = await this.prisma.stockLedger.findFirst({
      where: { referenceId: salesReturn.id },
    });
    if (stockLedgerExists) {
      console.log(`Inventory adjustment already processed for Sales Return ${salesReturn.returnNumber}. Skipping.`);
      return;
    }

    const stockLedgerEntries: any[] = [];

    for (const item of salesReturn.items) {
      const referenceType = salesReturn.sourceType === 'DELIVERY_CHALLAN'
        ? 'SALES_RETURN_DC'
        : 'SALES_RETURN_INV';

      const itemExists = await this.prisma.item.findUnique({
        where: { id: item.itemId },
      });

      const warehouseExists = await this.prisma.warehouse.findUnique({
        where: { id: salesReturn.warehouseId },
      });

      if (!itemExists) {
        throw new Error(`Item with ID ${item.itemId} does not exist`);
      }
      if (!warehouseExists) {
        throw new Error(`Warehouse with ID ${salesReturn.warehouseId} does not exist`);
      }

      stockLedgerEntries.push({
        itemId: itemExists.id,
        warehouseId: salesReturn.warehouseId,
        qty: Number(item.returnQty), // Positive for Sales Return (goods coming back into stock)
        movementType: 'INBOUND',
        unitCost: Number(item.unitPrice),
        rate: Number(item.unitPrice),
        referenceType,
        referenceId: salesReturn.id,
      });
    }

    if (stockLedgerEntries.length > 0) {
      await this.prisma.stockLedger.createMany({
        data: stockLedgerEntries,
      });
      await this.updateInventoryItems(stockLedgerEntries);
    }
  }

  private async updateInventoryItems(stockLedgerEntries: any[]) {
    for (const entry of stockLedgerEntries) {
      const existingInventory = await this.prisma.inventoryItem.findFirst({
        where: {
          itemId: entry.itemId,
          warehouseId: entry.warehouseId,
          status: 'AVAILABLE',
        },
      });

      if (existingInventory) {
        const newQuantity = Number(existingInventory.quantity) + Number(entry.qty);
        await this.prisma.inventoryItem.update({
          where: { id: existingInventory.id },
          data: { quantity: newQuantity },
        });
      } else {
        await this.prisma.inventoryItem.create({
          data: {
            itemId: entry.itemId,
            warehouseId: entry.warehouseId,
            quantity: Number(entry.qty),
            status: 'AVAILABLE',
          },
        });
      }
    }
  }

  private async processFinancialAdjustment(salesReturn: any) {
    const creditNoteExists = await this.prisma.creditNote.findFirst({
      where: { salesReturnId: salesReturn.id },
    });
    if (creditNoteExists) {
      console.log(`Financial adjustment already processed for Sales Return ${salesReturn.returnNumber}. Skipping.`);
      return creditNoteExists;
    }

    let salesInvoice: any = null;
    if (salesReturn.sourceType === 'INVOICE' && salesReturn.salesInvoiceId) {
      salesInvoice = await this.prisma.eRPSalesInvoice.findUnique({
        where: { id: salesReturn.salesInvoiceId },
      });
    } else if (salesReturn.sourceType === 'DELIVERY_CHALLAN' && salesReturn.deliveryChallanId) {
      salesInvoice = await this.prisma.eRPSalesInvoice.findFirst({
        where: {
          deliveryChallanId: salesReturn.deliveryChallanId,
        },
      });
    }

    const creditNoteNo = `CN-${Date.now()}`;
    const totalAmount = Number(salesReturn.totalAmount);

    return this.prisma.$transaction(async (tx) => {
      // 1. Create Credit Note
      const creditNote = await tx.creditNote.create({
        data: {
          creditNoteNo,
          date: new Date(),
          amount: salesReturn.totalAmount,
          salesReturnId: salesReturn.id,
          salesInvoiceId: salesInvoice?.id || null,
          customerId: salesReturn.customerId,
          status: 'APPROVED',
        },
      });

      // 2. Adjust Customer balance (reduce outstanding balance)
      const customer = await tx.customer.findUnique({
        where: { id: salesReturn.customerId },
      });
      if (customer) {
        const newBalance = Number(customer.balance) - totalAmount;
        await tx.customer.update({
          where: { id: salesReturn.customerId },
          data: { balance: newBalance },
        });
      }

      // 3. Update ERPSalesInvoice if associated
      if (salesInvoice) {
        const newReturnAmount = Number(salesInvoice.returnAmount || 0) + totalAmount;
        const newBalanceAmount = Math.max(0, Number(salesInvoice.grandTotal) - Number(salesInvoice.paidAmount) - newReturnAmount);
        await tx.eRPSalesInvoice.update({
          where: { id: salesInvoice.id },
          data: {
            returnAmount: newReturnAmount,
            balanceAmount: newBalanceAmount,
            paymentStatus: newBalanceAmount <= 0.01 ? 'FULLY_PAID' : (Number(salesInvoice.paidAmount) > 0 ? 'PARTIALLY_PAID' : 'UNPAID'),
          },
        });
      }

      return creditNote;
    });
  }

  private async autoGenerateJournalVoucher(salesReturn: any, ctx?: { userId?: string }) {
    const existingJV = await this.prisma.journalVoucher.findFirst({
      where: {
        description: {
          contains: `Sales Return ${salesReturn.returnNumber}`,
        },
      },
    });
    if (existingJV) {
      console.log(`Journal Voucher already generated for Sales Return ${salesReturn.returnNumber}. Skipping.`);
      return;
    }

    // Try finding Sales Return Parent account (60010004 or 40020001 / Sales Return) and Accounts Receivable
    const parentReturnAccount = await this.prisma.chartOfAccount.findFirst({
      where: { name: { contains: 'Sales Return', mode: 'insensitive' } },
    }) || await this.prisma.chartOfAccount.findFirst({
      where: { code: '60010004' },
    });

    const arParentAccount = await this.prisma.chartOfAccount.findFirst({
      where: { name: { contains: 'Accounts Receivable', mode: 'insensitive' } },
    }) || await this.prisma.chartOfAccount.findFirst({
      where: { code: '12010001' },
    });

    if (!parentReturnAccount || !arParentAccount) {
      console.log('Skipping auto JV generation: Sales Return or AR account not configured.');
      return;
    }

    const totalAmount = Number(salesReturn.totalAmount);
    const invoiceNo = salesReturn.salesInvoice?.invoiceNo || '';

    const details = [
      {
        accountId: parentReturnAccount.id,
        debit: totalAmount,
        credit: 0,
        narration: `Sales Return ${salesReturn.returnNumber} against ${invoiceNo}`,
        refBillNo: invoiceNo,
        taxType: 'Taxable',
      },
      {
        accountId: arParentAccount.id,
        debit: 0,
        credit: totalAmount,
        narration: `Sales Return ${salesReturn.returnNumber} - Customer Balance Credit`,
        refBillNo: invoiceNo,
        taxType: 'Taxable',
      },
    ];

    await this.journalVoucherService.create(
      {
        jvNo: `TEMP-JV-${Date.now()}`,
        jvDate: new Date(),
        description: `Auto-generated JV for Sales Return ${salesReturn.returnNumber}`,
        status: 'pending',
        details,
      },
      { userId: ctx?.userId },
    );
  }
}
