import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePurchaseReturnDto, ReturnSourceType } from './dto/create-purchase-return.dto';
import { UpdatePurchaseReturnDto } from './dto/update-purchase-return.dto';
import { FinanceAccountConfigService } from '../../finance/finance-account-config/finance-account-config.service';
import { AccountingService } from '../../finance/accounting/accounting.service';
import { AccountRoleKey } from '../../finance/finance-account-config/dto/finance-account-config.dto';
import { JournalVoucherService } from '../../finance/journal-voucher/journal-voucher.service';

import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';

@Injectable()
export class PurchaseReturnService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
    private financeConfig: FinanceAccountConfigService,
    private accounting: AccountingService,
    private readonly journalVoucherService: JournalVoucherService,
  ) {}

  async create(createDto: CreatePurchaseReturnDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      // Validate source document exists and is eligible
      await this.validateSourceDocument(createDto);

      // Generate return number
      const { nextReturnNumber } = await this.getNextReturnNumber();
      const returnNumber = nextReturnNumber;

      // Calculate totals
      const { subtotal, taxAmount, totalAmount } = this.calculateTotals(createDto);

      const created = await this.prisma.purchaseReturn.create({
        data: {
          returnNumber,
          sourceType: createDto.sourceType,
          grnId: createDto.grnId,
          landedCostId: createDto.landedCostId,
          purchaseInvoiceId: createDto.purchaseInvoiceId,
          supplierId: createDto.supplierId,
          warehouseId: createDto.warehouseId,
          returnType: createDto.returnType,
          reason: createDto.reason,
          notes: createDto.notes,
          staxEInvoiceNumber: createDto.staxEInvoiceNumber,
          subtotal,
          taxAmount,
          totalAmount,
          items: {
            create: createDto.items.map(item => ({
              sourceItemType: item.sourceItemType,
              grnItemId: item.grnItemId,
              landedCostItemId: item.landedCostItemId,
              purchaseInvoiceItemId: item.purchaseInvoiceItemId,
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
          grn: true,
          landedCost: true,
          purchaseInvoice: true,
          supplier: true,
          warehouse: true,
        },
      });

      runInBackground(
        'Create Purchase Return',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'purchase-return',
          entity: 'PurchaseReturn',
          entityId: created.id,
          description: `Created purchase return ${created.returnNumber}`,
          newValues: JSON.stringify(createDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return created;
    } catch (error: any) {
      runInBackground(
        'Create Purchase Return (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'purchase-return',
          entity: 'PurchaseReturn',
          description: 'Failed to create purchase return',
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
    return this.prisma.purchaseReturn.findMany({
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
        grn: true,
        landedCost: {
          include: {
            grn: true,
          },
        },
        purchaseInvoice: {
          include: {
            grn: true,
          },
        },
        supplier: true,
        warehouse: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const purchaseReturn = await this.prisma.purchaseReturn.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            grnItem: true,
            landedCostItem: true,
            purchaseInvoiceItem: true,
            item: {
              include: {
                size: true,
                color: true,
                brand: true,
              },
            },
          },
        },
        grn: {
          include: {
            purchaseOrder: true,
          },
        },
        landedCost: {
          include: {
            purchaseOrder: true,
          },
        },
        purchaseInvoice: {
          include: {
            grn: {
              include: {
                purchaseOrder: true,
              },
            },
            landedCost: {
              include: {
                purchaseOrder: true,
              },
            },
          },
        },
        debitNote: true,
        supplier: true,
        warehouse: true,
      },
    });

    if (!purchaseReturn) {
      throw new NotFoundException('purchase return not found');
    }

    return purchaseReturn;
  }

  async update(id: string, updateDto: UpdatePurchaseReturnDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existingReturn = await this.findOne(id);

      if (existingReturn.status !== 'DRAFT') {
        throw new BadRequestException('Only DRAFT returns can be updated');
      }

      const { subtotal, taxAmount, totalAmount } = this.calculateTotals(updateDto);

      // Only update the fields that are provided
      const updateData: any = {
        subtotal,
        taxAmount,
        totalAmount,
      };

      // Add optional fields only if they exist in updateDto
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
            grnItemId: item.grnItemId,
            landedCostItemId: item.landedCostItemId,
            purchaseInvoiceItemId: item.purchaseInvoiceItemId,
            itemId: item.itemId,
            description: item.description,
            returnQty: item.returnQty,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
            reason: item.reason,
          })),
        };
      }

      const updated = await this.prisma.purchaseReturn.update({
        where: { id },
        data: updateData,
        include: {
          items: true,
          grn: true,
          landedCost: true,
          supplier: true,
          warehouse: true,
        },
      });

      runInBackground(
        'Update Purchase Return',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'purchase-return',
          entity: 'PurchaseReturn',
          entityId: id,
          description: `Updated purchase return ${updated.returnNumber}`,
          newValues: JSON.stringify(updateDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return updated;
    } catch (error: any) {
      runInBackground(
        'Update Purchase Return (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'purchase-return',
          entity: 'PurchaseReturn',
          entityId: id,
          description: 'Failed to update purchase return',
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
      const purchaseReturn = await this.findOne(id);

      if (status === 'APPROVED' && purchaseReturn.status === 'SUBMITTED') {
        // Process inventory adjustment (Stock Ledger & Inventory Table)
        await this.processInventoryAdjustment(purchaseReturn);

        // Process financial impact if Case 2 (Post-Invoice Return)
        await this.processFinancialAdjustment(purchaseReturn);

        // Auto-generate Journal Voucher for local purchase return
        try {
          await this.autoGenerateJournalVoucher(purchaseReturn, ctx);
        } catch (jvError) {
          console.error('Failed to auto-generate Journal Voucher for Purchase Return:', jvError);
          throw jvError;
        }
      }

      const updated = await this.prisma.purchaseReturn.update({
        where: { id },
        data: {
          status,
          approvedBy: status === 'APPROVED' ? approvedBy : purchaseReturn.approvedBy,
          approvedAt: status === 'APPROVED' ? new Date() : purchaseReturn.approvedAt,
        },
      });

      runInBackground(
        'Update Purchase Return Status',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'purchase-return',
          entity: 'PurchaseReturn',
          entityId: id,
          description: `Updated purchase return status to ${status} for ${updated.returnNumber}`,
          newValues: JSON.stringify({ status }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return updated;
    } catch (error: any) {
      runInBackground(
        'Update Purchase Return Status (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'purchase-return',
          entity: 'PurchaseReturn',
          entityId: id,
          description: `Failed to update purchase return status to ${status}`,
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

  private async autoGenerateJournalVoucher(purchaseReturn: any, ctx?: { userId?: string }) {
    // 1. Resolve the associated Purchase Order to determine orderType (IMPORT vs LOCAL)
    const po = purchaseReturn.purchaseInvoice?.grn?.purchaseOrder
      || purchaseReturn.purchaseInvoice?.landedCost?.purchaseOrder
      || purchaseReturn.purchaseInvoice?.landedCost?.grn?.purchaseOrder
      || purchaseReturn.grn?.purchaseOrder
      || purchaseReturn.landedCost?.purchaseOrder
      || purchaseReturn.landedCost?.grn?.purchaseOrder;

    const orderType = po?.orderType || 'LOCAL';
    if (orderType.toUpperCase() === 'IMPORT') {
      console.log(`Skipping auto JV generation for Import Purchase Return ${purchaseReturn.returnNumber}`);
      return;
    }

    // 2. Resolve general reference numbers
    const invoiceNumber = purchaseReturn.purchaseInvoice?.invoiceNumber || '';
    const grnNumber = purchaseReturn.grn?.grnNumber 
      || purchaseReturn.purchaseInvoice?.grn?.grnNumber 
      || purchaseReturn.landedCost?.grn?.grnNumber 
      || '';

    const supplier = purchaseReturn.supplier;
    if (!supplier) {
      throw new BadRequestException('Supplier not found for this Purchase Return');
    }

    // 3. Group return items by brand name
    interface BrandGroup {
      brandName: string;
      quantity: number;
      subtotal: number;
      salesTaxAmount: number;
      advanceTaxAmount: number;
    }

    const brandGroupsMap = new Map<string, BrandGroup>();

    for (const returnItem of purchaseReturn.items) {
      const brandName = returnItem.item?.brand?.name || 'Generic';
      const qty = Number(returnItem.returnQty || 0);
      const lineTotal = Number(returnItem.lineTotal || 0);

      // Determine sales tax rate from the associated PurchaseInvoiceItem
      const taxRate = Number(returnItem.purchaseInvoiceItem?.taxRate || 0);
      const salesTax = (lineTotal * taxRate) / 100;

      // Determine advance tax rate from the associated PurchaseInvoice
      const advanceTaxRate = Number(purchaseReturn.purchaseInvoice?.advanceTaxRate || 0.50);
      const advanceTax = ((lineTotal + salesTax) * advanceTaxRate) / 100;

      if (!brandGroupsMap.has(brandName)) {
        brandGroupsMap.set(brandName, {
          brandName,
          quantity: 0,
          subtotal: 0,
          salesTaxAmount: 0,
          advanceTaxAmount: 0,
        });
      }

      const group = brandGroupsMap.get(brandName)!;
      group.quantity += qty;
      group.subtotal += lineTotal;
      group.salesTaxAmount += salesTax;
      group.advanceTaxAmount += advanceTax;
    }

    const roundToTwo = (num: number): number => {
      return Math.round((num + Number.EPSILON) * 100) / 100;
    };

    const details: any[] = [];

    // 4. Resolve Parent Accounts
    const parentReturnAccount = await this.prisma.chartOfAccount.findFirst({
      where: { code: '60020004' }
    });
    if (!parentReturnAccount) {
      throw new BadRequestException('Purchases Return Local account (60020004) not found in Chart of Accounts.');
    }

    const salesTaxParent = await this.prisma.chartOfAccount.findFirst({
      where: { code: '31070003' }
    });
    if (!salesTaxParent) {
      throw new BadRequestException('Sales Tax account (31070003) not found in Chart of Accounts.');
    }

    const advanceTaxParent = await this.prisma.chartOfAccount.findFirst({
      where: { code: '31080002' }
    });
    if (!advanceTaxParent) {
      throw new BadRequestException('Advance Tax account (31080002) not found in Chart of Accounts.');
    }

    const billsPayableParent = await this.prisma.chartOfAccount.findFirst({
      where: { code: '12010004' }
    });
    if (!billsPayableParent) {
      throw new BadRequestException('Bills Payable Local account (12010004) not found in Chart of Accounts.');
    }

    // Resolve tag accounts for vendor codes under the parents
    const salesTaxTag = await this.prisma.chartOfAccount.findFirst({
      where: { parentId: salesTaxParent.id, code: supplier.code }
    });
    if (!salesTaxTag) {
      throw new BadRequestException(`Tag account for vendor "${supplier.code}" not found under Sales Tax account (31070003).`);
    }

    const advanceTaxTag = await this.prisma.chartOfAccount.findFirst({
      where: { parentId: advanceTaxParent.id, code: supplier.code }
    });
    if (!advanceTaxTag) {
      throw new BadRequestException(`Tag account for vendor "${supplier.code}" not found under Advance Tax account (31080002).`);
    }

    const billsPayableTag = await this.prisma.chartOfAccount.findFirst({
      where: { parentId: billsPayableParent.id, code: supplier.code }
    });
    if (!billsPayableTag) {
      throw new BadRequestException(`Tag account for vendor "${supplier.code}" not found under Bills Payable Local account (12010004).`);
    }

    // 5. Build JV Detail Lines per Brand Group
    for (const group of brandGroupsMap.values()) {
      const brandName = group.brandName;
      const quantity = group.quantity;
      const subtotal = roundToTwo(group.subtotal);
      const salesTaxAmount = roundToTwo(group.salesTaxAmount);
      const advanceTaxAmount = roundToTwo(group.advanceTaxAmount);

      const valueInclSalesTax = roundToTwo(subtotal + salesTaxAmount);

      // Resolve tag account for brand name under Purchases Return Local
      const brandTag = await this.prisma.chartOfAccount.findFirst({
        where: { parentId: parentReturnAccount.id, name: { equals: brandName, mode: 'insensitive' } }
      });
      if (!brandTag) {
        throw new BadRequestException(`Tag account for brand "${brandName}" not found under Purchases Return Local account (60020004).`);
      }

      // Line 1: Purchases Return (60020004) - Credit
      details.push({
        accountId: parentReturnAccount.id,
        tagAccountId: brandTag.id,
        debit: 0,
        credit: subtotal,
        narration: `RET ${quantity} Pcs. of ${brandName} Shipment. ref 1 is ${invoiceNumber} ref 2 is ${grnNumber}`,
        refBillNo: invoiceNumber,
        refBillNo2: grnNumber,
        taxType: 'Taxable',
      });

      // Line 2: Sales Tax (31070003) - Credit
      if (salesTaxAmount > 0) {
        details.push({
          accountId: salesTaxParent.id,
          tagAccountId: salesTaxTag.id,
          debit: 0,
          credit: salesTaxAmount,
          narration: `RET Sales Tax for ${quantity} Pcs. of ${brandName} Shipment. ref 1 is ${invoiceNumber} ref 2 is ${grnNumber}`,
          refBillNo: invoiceNumber,
          refBillNo2: grnNumber,
          taxType: 'Taxable',
        });
      }

      // Line 3: Advance Tax (31080002) - Credit
      if (advanceTaxAmount > 0) {
        details.push({
          accountId: advanceTaxParent.id,
          tagAccountId: advanceTaxTag.id,
          debit: 0,
          credit: advanceTaxAmount,
          narration: `RET Advance Tax for ${quantity} Pcs. of ${brandName} Shipment. ref 1 is ${invoiceNumber} ref 2 is ${grnNumber}`,
          refBillNo: invoiceNumber,
          refBillNo2: grnNumber,
          taxType: 'Taxable',
        });
      }

      // Line 4: Bills Payable (12010004) - Debit (Value Incl. Sales Tax)
      details.push({
        accountId: billsPayableParent.id,
        tagAccountId: billsPayableTag.id,
        debit: valueInclSalesTax,
        credit: 0,
        narration: `RET ${quantity} Pcs. of ${brandName} Shipment. ref 1 is ${invoiceNumber} ref 2 is ${grnNumber}`,
        refBillNo: invoiceNumber,
        refBillNo2: grnNumber,
        taxType: 'Taxable',
      });

      // Line 5: Bills Payable (12010004) - Debit (Advance Tax Amount)
      if (advanceTaxAmount > 0) {
        details.push({
          accountId: billsPayableParent.id,
          tagAccountId: billsPayableTag.id,
          debit: advanceTaxAmount,
          credit: 0,
          narration: `RET Advance Tax for ${quantity} Pcs. of ${brandName} Shipment. ref 1 is ${invoiceNumber} ref 2 is ${grnNumber}`,
          refBillNo: invoiceNumber,
          refBillNo2: grnNumber,
          taxType: 'Taxable',
        });
      }
    }

    if (details.length === 0) {
      console.log('No JV details to generate. Skipping.');
      return;
    }

    // 6. Balance Check & Rounding Adjustment
    const totalDebit = details.reduce((sum, d) => sum + d.debit, 0);
    const totalCredit = details.reduce((sum, d) => sum + d.credit, 0);
    const diff = roundToTwo(totalDebit - totalCredit);
    if (Math.abs(diff) > 0.001) {
      if (diff > 0) {
        // debits > credits, add diff to the credit of the first credit line
        const creditLine = details.find(d => d.credit > 0);
        if (creditLine) {
          creditLine.credit = roundToTwo(creditLine.credit + diff);
        }
      } else {
        // credits > debits, add absolute diff to the debit of the first debit line
        const debitLine = details.find(d => d.debit > 0);
        if (debitLine) {
          debitLine.debit = roundToTwo(debitLine.debit + Math.abs(diff));
        }
      }
    }

    // 7. Create Draft Journal Voucher
    await this.journalVoucherService.create({
      jvNo: `TEMP-JV-${Date.now()}`,
      jvDate: new Date(),
      description: `Auto-generated JV for Purchase Return ${purchaseReturn.returnNumber}`,
      status: 'pending',
      details,
    }, {
      userId: ctx?.userId,
    });

    console.log(`Auto-generated draft Journal Voucher successfully for Purchase Return ${purchaseReturn.returnNumber}`);
  }

  private async processFinancialAdjustment(purchaseReturn: any) {
    // Find associated Purchase Invoice
    let purchaseInvoice: any = null;

    if (purchaseReturn.sourceType === 'INVOICE') {
      purchaseInvoice = await this.prisma.purchaseInvoice.findUnique({
        where: { id: purchaseReturn.purchaseInvoiceId },
      });
    } else if (purchaseReturn.sourceType === 'GRN' && purchaseReturn.grnId) {
      purchaseInvoice = await this.prisma.purchaseInvoice.findFirst({
        where: { 
          grnId: purchaseReturn.grnId,
          status: 'APPROVED'
        }
      });
    } else if (purchaseReturn.sourceType === 'LANDED_COST' && purchaseReturn.landedCostId) {
      purchaseInvoice = await this.prisma.purchaseInvoice.findFirst({
        where: { 
          landedCostId: purchaseReturn.landedCostId,
          status: 'APPROVED'
        }
      });
    }

    if (!purchaseInvoice) {
      console.log('No approved Purchase Invoice found for this return. Skipping financial adjustment.');
      return;
    }

    console.log(`Found Purchase Invoice ${purchaseInvoice.invoiceNumber}. Processing financial adjustment.`);

    // Generate Debit Note Number
    const debitNoteNo = `DN-${Date.now()}`;
    const totalAmount = Number(purchaseReturn.totalAmount);

    return this.prisma.$transaction(async (tx) => {
      // 1. Create Debit Note
      const debitNote = await tx.debitNote.create({
        data: {
          debitNoteNo,
          date: new Date(),
          amount: purchaseReturn.totalAmount,
          purchaseReturnId: purchaseReturn.id,
          purchaseInvoiceId: purchaseInvoice.id,
          supplierId: purchaseReturn.supplierId,
          status: 'APPROVED',
        }
      });

      // 2. Post Journal Entry to GL
      const supplier = await tx.supplier.findUnique({
        where: { id: purchaseReturn.supplierId },
        include: { chartOfAccounts: { select: { id: true } } },
      });

      let apPartiesAccountId: string | null = null;
      try {
        apPartiesAccountId = await this.financeConfig.resolveAccount(AccountRoleKey.AP_PARTIES);
      } catch (error) {
        console.error('AP_PARTIES account resolution failed', error);
      }

      let purchasesReturnAccountId: string | null = null;
      try {
        purchasesReturnAccountId = await this.financeConfig.resolveAccount(AccountRoleKey.PURCHASES_RETURN);
      } catch (error) {
        console.error('PURCHASES_RETURN account resolution failed', error);
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
        } else if (supplier.chartOfAccounts?.length) {
          payableAccounts = supplier.chartOfAccounts.map(acc => ({
            accountId: acc.id,
          }));
        }
      } else if (supplier?.chartOfAccounts?.length) {
        payableAccounts = supplier.chartOfAccounts.map(acc => ({
          accountId: acc.id,
        }));
      }

      if (purchasesReturnAccountId && payableAccounts.length > 0) {
        const debitPerAccount = totalAmount / payableAccounts.length;
        const debitLines = payableAccounts.map(acc => ({
          accountId: acc.accountId,
          tagAccountId: acc.tagAccountId,
          debit: debitPerAccount,
          credit: 0,
        }));

        const creditLines = [{ accountId: purchasesReturnAccountId, debit: 0, credit: totalAmount }];

        await this.accounting.postLines([...debitLines, ...creditLines], {
          sourceType: 'PURCHASE_RETURN',
          sourceId: purchaseReturn.id,
          sourceRef: purchaseReturn.returnNumber,
          description: `Purchase Return approved: ${purchaseReturn.returnNumber}`,
          transactionDate: new Date(),
        }, tx);
      }

      // 3. Write supplier ledger debit entry & update supplier current balance
      const supplierForLedger = await tx.supplier.findUnique({
        where: { id: purchaseReturn.supplierId },
        select: { currentBalance: true, advanceBalance: true },
      });
      if (supplierForLedger) {
        const newBalance = Number(supplierForLedger.currentBalance) - totalAmount;
        await tx.supplierLedger.create({
          data: {
            supplierId: purchaseReturn.supplierId,
            entryDate: new Date(),
            entryType: 'PURCHASE_RETURN',
            sourceId: purchaseReturn.id,
            sourceRef: purchaseReturn.returnNumber,
            description: `Purchase Return approved`,
            debit: totalAmount,
            credit: 0,
            balanceAfter: newBalance,
            advanceDebit: 0,
            advanceCredit: 0,
            advanceBalance: Number(supplierForLedger.advanceBalance),
          },
        });
        await tx.supplier.update({
          where: { id: purchaseReturn.supplierId },
          data: { currentBalance: newBalance },
        });
      }

      // 4. Update Purchase Invoice ONLY for old/legacy flows.
      // For sourceType === 'INVOICE', we do NOT update purchaseInvoice amounts or paymentStatus at all!
      if (purchaseReturn.sourceType !== 'INVOICE') {
        const newReturnAmount = Number(purchaseInvoice.returnAmount || 0) + totalAmount;
        const newRemainingAmount = Number(purchaseInvoice.totalAmount) - Number(purchaseInvoice.paidAmount) - newReturnAmount;

        await tx.purchaseInvoice.update({
          where: { id: purchaseInvoice.id },
          data: {
            returnAmount: newReturnAmount,
            remainingAmount: Math.max(0, newRemainingAmount),
            paymentStatus: newRemainingAmount <= 0.01 ? 'FULLY_PAID' : (Number(purchaseInvoice.paidAmount) > 0 ? 'PARTIALLY_PAID' : 'UNPAID')
          }
        });
        console.log(`Updated PI ${purchaseInvoice.invoiceNumber}: ReturnAmount=${newReturnAmount}, RemainingAmount=${newRemainingAmount}`);
      }

      return debitNote;
    });
  }

  async remove(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const purchaseReturn = await this.findOne(id);

      if (purchaseReturn.status !== 'DRAFT') {
        throw new BadRequestException('Only DRAFT returns can be deleted');
      }

      const deleted = await this.prisma.purchaseReturn.delete({ where: { id } });

      runInBackground(
        'Delete Purchase Return',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'purchase-return',
          entity: 'PurchaseReturn',
          entityId: id,
          description: `Deleted purchase return ${deleted.returnNumber}`,
          oldValues: JSON.stringify(purchaseReturn),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return deleted;
    } catch (error: any) {
      runInBackground(
        'Delete Purchase Return (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'purchase-return',
          entity: 'PurchaseReturn',
          entityId: id,
          description: 'Failed to delete purchase return',
          errorMessage: error?.message,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async getEligibleGrns() {
    const grns = await this.prisma.goodsReceiptNote.findMany({
      where: {
        status: 'VALUED',
        // Exclude GRNs that already have Landed Cost records
        landedCosts: {
          none: {}
        },
        // Add date filter for 30 days
        receivedDate: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      },
      include: {
        purchaseOrder: {
          include: {
            vendor: true,
            items: true, // Include PO items to get unit prices
          },
        },
        warehouse: true,
        items: { include: { item: { include: { size: true } } } },
      },
      orderBy: { receivedDate: 'desc' },
    });

    // Map the response to match frontend expectations
    return grns.map(grn => ({
      id: grn.id,
      grnNumber: grn.grnNumber,
      supplier: grn.purchaseOrder.vendor, // Map vendor to supplier
      warehouse: grn.warehouse,
      items: grn.items.map(grnItem => {
        // Find corresponding PO item to get unit price
        const poItem = grn.purchaseOrder.items.find(poi => poi.itemId === grnItem.itemId);
        return {
          ...grnItem,
          unitPrice: poItem?.unitPrice || 0,
          description: (grnItem as any).item?.description || poItem?.description || grnItem.description,
          displayCode: (grnItem as any).item?.itemId || grnItem.itemId,
          size: (grnItem as any).item?.size?.name || null,
        };
      }),
    }));
  }

  async getEligibleLandedCosts() {
    const landedCosts = await this.prisma.landedCost.findMany({
      where: {
        status: 'SUBMITTED',
        // Add date filter for 30 days
        date: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      },
      include: {
        grn: {
          include: {
            purchaseOrder: true,
            warehouse: true,
          },
        },
        supplier: true,
        items: { include: { item: { include: { size: true } } } },
      },
      orderBy: { date: 'desc' },
    });

    // Map the response to match frontend expectations
    return landedCosts.map(lc => ({
      id: lc.id,
      landedCostNumber: lc.landedCostNumber,
      supplier: lc.supplier,
      warehouse: lc.grn.warehouse,
      items: lc.items.map(lcItem => ({
        ...lcItem,
        description: (lcItem as any).item?.description || lcItem.description,
        displayCode: (lcItem as any).item?.itemId || lcItem.itemId,
        size: (lcItem as any).item?.size?.name || null,
      })),
    }));
  }

  async getEligibleInvoices() {
    const invoices = await this.prisma.purchaseInvoice.findMany({
      where: {
        status: 'APPROVED',
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      },
      include: {
        supplier: true,
        warehouse: true,
        grn: true,
        landedCost: {
          include: {
            grn: true,
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
      },
      orderBy: { createdAt: 'desc' },
    });

    return invoices.map(inv => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      grn: inv.grn,
      landedCost: inv.landedCost,
      supplier: inv.supplier,
      warehouse: inv.warehouse,
      advanceTaxRate: Number(inv.advanceTaxRate || 0.5),
      items: inv.items.map(item => ({
        id: item.id,
        itemId: item.itemId,
        sku: item.item?.sku || '',
        hsCodeStr: item.item?.hsCodeStr || '',
        description: item.description || item.item?.description || '',
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        taxRate: Number(item.taxRate),
        taxAmount: Number(item.taxAmount),
        discountRate: Number(item.discountRate),
        discountAmount: Number(item.discountAmount),
        lineTotal: Number(item.lineTotal),
        size: item.item?.size?.name || null,
        color: item.item?.color?.name || null,
      })),
    }));
  }

  private async validateSourceDocument(createDto: CreatePurchaseReturnDto) {
    if (createDto.sourceType !== ReturnSourceType.INVOICE) {
      throw new BadRequestException('Only Purchase Invoice (INVOICE) returns are supported');
    }

    if (!createDto.purchaseInvoiceId) {
      throw new BadRequestException('Purchase Invoice ID is required for Invoice-based returns');
    }

    const invoice = await this.prisma.purchaseInvoice.findUnique({
      where: { id: createDto.purchaseInvoiceId },
    });

    if (!invoice) {
      throw new NotFoundException('Purchase Invoice not found');
    }

    if (invoice.status !== 'APPROVED') {
      throw new BadRequestException('Only APPROVED Purchase Invoices can be returned');
    }
  }

  private calculateTotals(dto: CreatePurchaseReturnDto | UpdatePurchaseReturnDto) {
    const subtotal = dto.items?.reduce((sum, item) => sum + Number(item.lineTotal), 0) || 0;
    const taxAmount = 0; // Calculate tax if needed
    const totalAmount = subtotal + taxAmount;

    return { subtotal, taxAmount, totalAmount };
  }

  private async processInventoryAdjustment(purchaseReturn: any) {
    // Create stock ledger entries for inventory adjustment
    const stockLedgerEntries: any[] = [];

    for (const item of purchaseReturn.items) {
      const referenceType = purchaseReturn.sourceType === 'GRN' 
        ? 'PURCHASE_RETURN_GRN' 
        : purchaseReturn.sourceType === 'LANDED_COST'
          ? 'PURCHASE_RETURN_LC'
          : 'PURCHASE_RETURN_INV';

      // Debug log to check values
      console.log('Purchase Return Stock Ledger Entry:', {
        itemId: item.itemId,
        warehouseId: purchaseReturn.warehouseId,
        returnQty: item.returnQty,
        calculatedQty: -Number(item.returnQty),
        movementType: 'OUTBOUND'
      });

      // Validate that item and warehouse exist before creating stock ledger entry
      // Find item by its UUID
      const itemExists = await this.prisma.item.findUnique({
        where: { id: item.itemId } // Strict UUID lookup
      });

      const warehouseExists = await this.prisma.warehouse.findUnique({
        where: { id: purchaseReturn.warehouseId }
      });

      if (!itemExists) {
        console.error(`Item not found with code: ${item.itemId}`);
        throw new Error(`Item with code ${item.itemId} does not exist`);
      }

      if (!warehouseExists) {
        console.error(`Warehouse not found: ${purchaseReturn.warehouseId}`);
        throw new Error(`Warehouse with ID ${purchaseReturn.warehouseId} does not exist`);
      }

      stockLedgerEntries.push({
        itemId: itemExists.id, // Use actual UUID ID, not the code
        warehouseId: purchaseReturn.warehouseId,
        qty: -Number(item.returnQty), // Negative for return (outbound)
        movementType: 'OUTBOUND', // Use correct enum value
        unitCost: Number(item.unitPrice),
        rate: Number(item.unitPrice), // Add rate field
        referenceType,
        referenceId: purchaseReturn.id,
      });
    }

    console.log('Stock Ledger Entries to Create:', stockLedgerEntries);

    // Create stock ledger entries
    if (stockLedgerEntries.length > 0) {
      try {
        await this.prisma.stockLedger.createMany({
          data: stockLedgerEntries,
        });
        console.log('Stock ledger entries created successfully');

        // Update inventory items table
        await this.updateInventoryItems(stockLedgerEntries);
        
      } catch (error) {
        console.error('Error creating stock ledger entries:', error);
        throw error;
      }
    }
  }

  private async updateInventoryItems(stockLedgerEntries: any[]) {
    for (const entry of stockLedgerEntries) {
      try {
        // Find existing inventory item
        const existingInventory = await this.prisma.inventoryItem.findFirst({
          where: {
            itemId: entry.itemId,
            warehouseId: entry.warehouseId,
            status: 'AVAILABLE'
          }
        });

        if (existingInventory) {
          // Update existing inventory
          const newQuantity = Number(existingInventory.quantity) + Number(entry.qty);
          
          await this.prisma.inventoryItem.update({
            where: { id: existingInventory.id },
            data: { 
              quantity: Math.max(0, newQuantity) // Ensure quantity doesn't go negative
            }
          });

          console.log(`Updated inventory: Item ${entry.itemId}, Old Qty: ${existingInventory.quantity}, Change: ${entry.qty}, New Qty: ${Math.max(0, newQuantity)}`);
        } else {
          console.log(`No inventory item found for item ${entry.itemId} in warehouse ${entry.warehouseId}`);
        }
      } catch (error) {
        console.error(`Error updating inventory for item ${entry.itemId}:`, error);
      }
    }
  }

  async getNextReturnNumber(): Promise<{ nextReturnNumber: string }> {
    const currentYear = new Date().getFullYear();
    const prefix = 'PR';
    
    const lastReturn = await this.prisma.purchaseReturn.findFirst({
      where: {
        returnNumber: {
          startsWith: `${prefix}-${currentYear}`,
        },
      },
      orderBy: {
        returnNumber: 'desc',
      },
    });

    let nextNumber = 1;
    if (lastReturn) {
      const lastNumber = parseInt(lastReturn.returnNumber.split('-').pop() || '0');
      if (!isNaN(lastNumber)) {
        nextNumber = lastNumber + 1;
      }
    }

    const nextReturnNumber = `${prefix}-${currentYear}-${nextNumber.toString().padStart(4, '0')}`;
    return { nextReturnNumber };
  }
}