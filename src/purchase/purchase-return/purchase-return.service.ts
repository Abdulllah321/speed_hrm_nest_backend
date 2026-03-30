import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePurchaseReturnDto, ReturnSourceType } from './dto/create-purchase-return.dto';
import { UpdatePurchaseReturnDto } from './dto/update-purchase-return.dto';

@Injectable()
export class PurchaseReturnService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreatePurchaseReturnDto) {
    // Validate source document exists and is eligible
    await this.validateSourceDocument(createDto);

    // Generate return number
    const returnNumber = `PR-${Date.now()}`;

    // Calculate totals
    const { subtotal, taxAmount, totalAmount } = this.calculateTotals(createDto);

    return this.prisma.purchaseReturn.create({
      data: {
        returnNumber,
        sourceType: createDto.sourceType,
        grnId: createDto.grnId,
        landedCostId: createDto.landedCostId,
        supplierId: createDto.supplierId,
        warehouseId: createDto.warehouseId,
        returnType: createDto.returnType,
        reason: createDto.reason,
        notes: createDto.notes,
        subtotal,
        taxAmount,
        totalAmount,
        items: {
          create: createDto.items.map(item => ({
            sourceItemType: item.sourceItemType,
            grnItemId: item.grnItemId,
            landedCostItemId: item.landedCostItemId,
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
        supplier: true,
        warehouse: true,
      },
    });
  }

  async findAll(status?: string) {
    return this.prisma.purchaseReturn.findMany({
      where: status && status !== 'ALL' ? { status } : {},
      include: {
        items: {
          include: {
            item: true,
          },
        },
        grn: true,
        landedCost: true,
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
            item: true,
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
        debitNote: true,
        supplier: true,
        warehouse: true,
      },
    });

    if (!purchaseReturn) {
      throw new NotFoundException('Purchase return not found');
    }

    return purchaseReturn;
  }

  async update(id: string, updateDto: UpdatePurchaseReturnDto) {
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
    if (updateDto.reason !== undefined) updateData.reason = updateDto.reason;
    if (updateDto.notes !== undefined) updateData.notes = updateDto.notes;

    return this.prisma.purchaseReturn.update({
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
  }

  async updateStatus(id: string, status: string, approvedBy?: string) {
    const purchaseReturn = await this.findOne(id);

    if (status === 'APPROVED' && purchaseReturn.status === 'SUBMITTED') {
      // Process inventory adjustment (Stock Ledger & Inventory Table)
      await this.processInventoryAdjustment(purchaseReturn);

      // Process financial impact if Case 2 (Post-Invoice Return)
      await this.processFinancialAdjustment(purchaseReturn);
    }

    return this.prisma.purchaseReturn.update({
      where: { id },
      data: {
        status,
        approvedBy: status === 'APPROVED' ? approvedBy : purchaseReturn.approvedBy,
        approvedAt: status === 'APPROVED' ? new Date() : purchaseReturn.approvedAt,
      },
    });
  }

  private async processFinancialAdjustment(purchaseReturn: any) {
    // Find associated Purchase Invoice
    let purchaseInvoice: any = null;

    if (purchaseReturn.sourceType === 'GRN' && purchaseReturn.grnId) {
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
      console.log('No approved Purchase Invoice found for this return source. Skipping financial adjustment.');
      return;
    }

    console.log(`Found Purchase Invoice ${purchaseInvoice.invoiceNumber}. Processing adjustment against Debit Note.`);

    // Generate Debit Note Number
    const debitNoteNo = `DN-${Date.now()}`;

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

      // 2. Update Purchase Invoice
      // Important: totalAmount remains unchanged (original value)
      // returnAmount is incremented
      // remainingAmount is reduced
      const newReturnAmount = Number(purchaseInvoice.returnAmount || 0) + Number(purchaseReturn.totalAmount);
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
      
      return debitNote;
    });
  }

  async remove(id: string) {
    const purchaseReturn = await this.findOne(id);

    if (purchaseReturn.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT returns can be deleted');
    }

    return this.prisma.purchaseReturn.delete({ where: { id } });
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
        items: { include: { item: true } },
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
        items: { include: { item: true } },
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
      })),
    }));
  }

  private async validateSourceDocument(createDto: CreatePurchaseReturnDto) {
    if (createDto.sourceType === ReturnSourceType.GRN) {
      if (!createDto.grnId) {
        throw new BadRequestException('GRN ID is required for GRN-based returns');
      }

      const grn = await this.prisma.goodsReceiptNote.findUnique({
        where: { id: createDto.grnId },
      });

      if (!grn) {
        throw new NotFoundException('GRN not found');
      }

      if (grn.status !== 'VALUED') {
        throw new BadRequestException('Only VALUED GRNs can be returned');
      }
    } else if (createDto.sourceType === ReturnSourceType.LANDED_COST) {
      if (!createDto.landedCostId) {
        throw new BadRequestException('Landed Cost ID is required for Landed Cost-based returns');
      }

      const landedCost = await this.prisma.landedCost.findUnique({
        where: { id: createDto.landedCostId },
      });

      if (!landedCost) {
        throw new NotFoundException('Landed Cost not found');
      }

      if (landedCost.status !== 'SUBMITTED') {
        throw new BadRequestException('Only SUBMITTED Landed Costs can be returned');
      }
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
        : 'PURCHASE_RETURN_LC';

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
}