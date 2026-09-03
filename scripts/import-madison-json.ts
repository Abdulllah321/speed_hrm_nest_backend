import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const tenantArg = args.find((a) => a.startsWith('--tenant='));
const targetTenant = tenantArg ? tenantArg.split('=')[1] : null;

// JSON Data file path
const jsonPath = path.join(__dirname, '../data/Adidas Medison Mall 01-07-26 to 24-08-26.json');

if (!fs.existsSync(jsonPath)) {
  console.error(`❌ Error: JSON file not found at ${jsonPath}`);
  process.exit(1);
}

function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!masterKeyString || masterKeyString.length < 32) {
    throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
  }
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const algorithm = 'aes-256-gcm';

  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(algorithm, masterKey, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

interface RawTransferRow {
  'Stock TR Out Location': string;
  'Stock TR Out Location Code': string;
  DocumentNumber: number;
  DocumentDate: string;
  DocumentType: string;
  'Stock Deliver To Location': string;
  'Stock Deliver to Location Code': string;
  BarCode: string;
  Quantity: number;
  ReceivingDocumentNo?: number;
  ReceivingDocumentDate?: string;
  Remarks?: string;
  DocumentStatus?: string;
}

interface RawSaleRow {
  DocumentNumber: number;
  DocumentDate: string;
  BarCode: string;
  Quantity: number;
  UnitPrice: number;
  Price_W_O_T: number;
  Total_Price_W_O_T: number;
  DiscountAmount: number;
  'Value Ex Sales Tax': number;
  'Sales Tax': number;
  'Additional Sales Tax'?: number;
  'Total Sales Tax': number;
  'Value Incl Sales Tax': number;
  CashSale?: number;
  CashRetrun?: number;
  CardSale?: number;
  CreditSale?: number;
  GiftVoucherAmount?: number;
  CreditVoucherAmount?: number;
  ExchangeVoucherAmount?: number;
  ClaimVoucherAmount?: number;
  GiftVoucherAmount_Corporate?: number;
  CreditVoucherIssuedAmount?: number;
  RewardVoucherAmount?: number;
  OnCreditAmount?: number;
  CostCentre: string;
  'Location Code': string;
  'POS ID': number;
  'FBR Invoice#'?: string;
  DiscountRate_Given?: number;
  DiscountRate_Default_Current?: number;
  Remarks?: string;
  'Is Alliance Discount'?: string;
  SalesPerson?: string;
}

interface RawReturnRow {
  DocumentNumber: number;
  DocumentDate: string;
  Type: string;
  'SUB Type': string;
  BarCode: string;
  Quantity: number;
  UnitPrice: number;
  Price_W_O_T: number;
  Total_Price_W_O_T: number;
  DiscountAmount: number;
  'Value Ex Sales Tax': number;
  'Sales Tax': number;
  'Additional Sales Tax'?: number;
  'Total Sales Tax': number;
  'Value Incl Sales Tax': number;
  CostCentre: string;
  'Location Code': string;
  'POS ID'?: number;
  'FBR Invoice#'?: string;
  DiscountRate_Given?: number;
  Remarks?: string;
  'Is Alliance Discount'?: string;
  FKInvoiceNumber_Sale?: number;
  DocumentDate_Sale?: string;
  FKInvoiceNumber_Settle?: number;
  DocumentDate_Settle?: string;
}

interface RawOutstandingVoucherRow {
  CostCentre: string;
  'Location Code': string;
  DocumentNumber: number;
  DocumentDate: string;
  IssueFromFKInvoiceNumber?: number;
  Amount: number;
  FKCostCentreID?: number;
}

function parseDate(dateStr?: string | null): Date {
  if (!dateStr || dateStr.trim() === '') return new Date();
  const cleaned = dateStr.trim();
  const parts = cleaned.split(' ');
  const dateParts = parts[0].split('/');
  if (dateParts.length === 3) {
    const month = parseInt(dateParts[0], 10) - 1;
    const day = parseInt(dateParts[1], 10);
    const year = parseInt(dateParts[2], 10);

    let hours = 0;
    let minutes = 0;
    if (parts[1]) {
      const timeParts = parts[1].split(':');
      hours = parseInt(timeParts[0], 10) || 0;
      minutes = parseInt(timeParts[1], 10) || 0;
    }
    return new Date(year, month, day, hours, minutes);
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date() : d;
}

function getFySuffix(d: Date): string {
  const m = d.getMonth() + 1;
  const y = d.getFullYear();
  const startYr = m >= 7 ? y : y - 1;
  const endYr = startYr + 1;
  return `${String(endYr).slice(-2)}`;
}

async function processUnifiedTenantData(prisma: PrismaClient, jsonData: any) {
  const transferRows: RawTransferRow[] = jsonData['Transfer OUT Or IN'] || [];
  const saleRows: RawSaleRow[] = jsonData['Sale'] || [];
  const returnRows: RawReturnRow[] = jsonData['Return'] || [];
  const outstandingVoucherRows: RawOutstandingVoucherRow[] = jsonData['Outstanding Credit Vouchers'] || [];

  const locationCache = new Map<string, any>();
  const itemCache = new Map<string, any>();

  let defaultWarehouse: any = null;
  if (!isDryRun) {
    try {
      defaultWarehouse = await prisma.warehouse.findFirst();
    } catch {}

    if (!defaultWarehouse) {
      try {
        defaultWarehouse = await prisma.warehouse.create({
          data: {
            code: 'C40001',
            name: 'LOGISTIC AREA CENTRAL WAREHOUSE',
            type: 'GENERAL',
            isActive: true,
          },
        });
      } catch {
        defaultWarehouse = { id: null, code: 'C40001', name: 'LOGISTIC AREA CENTRAL WAREHOUSE' };
      }
    }
  } else {
    defaultWarehouse = { id: 'dry-run-wh', code: 'C40001', name: 'LOGISTIC AREA CENTRAL WAREHOUSE' };
  }

  async function resolveLocation(code: string, name: string): Promise<any> {
    if (locationCache.has(code)) return locationCache.get(code)!;
    if (!isDryRun) {
      let loc = await prisma.location.findFirst({
        where: {
          OR: [{ code }, { shortCode: code }, { name }],
        },
        select: { id: true, code: true, shortCode: true, name: true, warehouseId: true },
      });
      if (!loc) {
        const createData: any = {
          code,
          shortCode: code,
          name,
          type: 'STORE',
          isActive: true,
        };
        if (defaultWarehouse?.id) {
          createData.warehouseId = defaultWarehouse.id;
        }
        loc = await prisma.location.create({
          data: createData,
          select: { id: true, code: true, shortCode: true, name: true, warehouseId: true },
        });
      }
      locationCache.set(code, loc);
      return loc;
    } else {
      const loc = { id: `loc-${code}`, code, shortCode: code, name, warehouseId: defaultWarehouse?.id };
      locationCache.set(code, loc);
      return loc;
    }
  }

  async function resolveItem(barcode: string, unitPrice: number = 0): Promise<any> {
    if (itemCache.has(barcode)) return itemCache.get(barcode)!;
    if (!isDryRun) {
      let item = await prisma.item.findFirst({ where: { barCode: barcode } });
      if (!item) {
        item = await prisma.item.create({
          data: {
            itemId: `ITEM-${barcode}`,
            sku: barcode,
            barCode: barcode,
            description: `POS Item (${barcode})`,
            unitPrice,
            unitCost: 0,
            status: 'active',
            isActive: true,
          },
        });
      }
      itemCache.set(barcode, item);
      return item;
    } else {
      const item = { id: `item-${barcode}`, barCode: barcode, unitPrice };
      itemCache.set(barcode, item);
      return item;
    }
  }

  // Pre-cache items & locations across all 4 datasets
  for (const r of transferRows) {
    await resolveLocation(r['Stock TR Out Location Code'], r['Stock TR Out Location']);
    await resolveLocation(r['Stock Deliver to Location Code'], r['Stock Deliver To Location']);
    await resolveItem(r.BarCode);
  }
  for (const r of saleRows) {
    await resolveLocation(r['Location Code'], r.CostCentre);
    await resolveItem(r.BarCode, r.UnitPrice);
  }
  for (const r of returnRows) {
    await resolveLocation(r['Location Code'], r.CostCentre);
    await resolveItem(r.BarCode, r.UnitPrice);
  }
  for (const r of outstandingVoucherRows) {
    await resolveLocation(r['Location Code'], r.CostCentre);
  }

  // ==========================================
  // MODULE 1: Stock Transfers (STN -> TransferRequest)
  // ==========================================
  console.log(`\n📦 [MODULE 1/4] Processing ${transferRows.length} Stock Transfer Note items...`);
  const stnGroups = new Map<string, RawTransferRow[]>();
  for (const r of transferRows) {
    const key = `${r.DocumentNumber}_${r.DocumentType}_${r['Stock TR Out Location Code']}_${r['Stock Deliver to Location Code']}`;
    if (!stnGroups.has(key)) stnGroups.set(key, []);
    stnGroups.get(key)!.push(r);
  }

  let importedSTNs = 0;
  let totalSTNItems = 0;

  for (const [groupKey, groupRows] of stnGroups.entries()) {
    const sample = groupRows[0];
    const fromLoc = locationCache.get(sample['Stock TR Out Location Code'])!;
    const toLoc = locationCache.get(sample['Stock Deliver to Location Code'])!;
    const docDate = parseDate(sample.DocumentDate);
    const recvDate = parseDate(sample.ReceivingDocumentDate || sample.DocumentDate);
    const fySuffix = getFySuffix(docDate);
    const outCode = fromLoc.shortCode?.trim() || fromLoc.code?.trim() || sample['Stock TR Out Location Code'];
    const cleanOutCode = outCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const requestNo = `STN-${cleanOutCode}${fySuffix}-${String(sample.DocumentNumber).padStart(5, '0')}`;
    const isReceived = Boolean(sample.ReceivingDocumentNo || sample.DocumentStatus?.toLowerCase().includes('approved') || sample.DocumentStatus?.toLowerCase().includes('closed'));

    if (isDryRun) {
      importedSTNs++;
      totalSTNItems += groupRows.length;
      continue;
    }

    const existingTransfer = await prisma.transferRequest.findFirst({
      where: { requestNo },
      select: { id: true },
    });

    if (existingTransfer) {
      await prisma.stockMovement.deleteMany({ where: { referenceId: existingTransfer.id } });
      await prisma.stockLedger.deleteMany({ where: { referenceId: existingTransfer.id } });
      await prisma.transferRequestItem.deleteMany({ where: { transferRequestId: existingTransfer.id } });
      await prisma.transferRequest.delete({ where: { id: existingTransfer.id } });
    }

    const transferNotes = `TR OUT No: ${sample.DocumentNumber} | RecDocNo: ${sample.ReceivingDocumentNo || 'N/A'} | Remarks: ${sample.Remarks || ''}`;

    const transferRequest = await prisma.transferRequest.create({
      data: {
        requestNo,
        fromLocationId: fromLoc.id,
        toLocationId: toLoc.id,
        transferType: 'OUTLET_TO_OUTLET',
        requestDate: docDate,
        createdAt: docDate,
        sourceApprovedAt: docDate,
        dispatchDate: docDate,
        status: isReceived ? 'COMPLETED' : 'SOURCE_APPROVED',
        notes: transferNotes,
      },
    });

    let idx = 0;
    for (const row of groupRows) {
      idx++;
      const item = itemCache.get(row.BarCode);
      const qty = Math.abs(row.Quantity);
      const unitPrice = item.unitPrice || 0;

      await prisma.transferRequestItem.create({
        data: {
          transferRequestId: transferRequest.id,
          itemId: item.id,
          quantity: qty,
          fulfilledQty: isReceived ? qty : 0,
        },
      });

      const effectiveWhId = fromLoc.warehouseId || defaultWarehouse?.id;

      if (effectiveWhId) {
        await prisma.stockLedger.create({
          data: {
            itemId: item.id,
            warehouseId: effectiveWhId,
            locationId: fromLoc.id,
            qty: -qty,
            referenceType: 'TRANSFER_OUT',
            referenceId: transferRequest.id,
            movementType: 'TRANSFER',
            unitCost: unitPrice,
            createdAt: docDate,
          },
        });

        if (isReceived) {
          const destWhId = toLoc.warehouseId || defaultWarehouse?.id || effectiveWhId;
          await prisma.stockLedger.create({
            data: {
              itemId: item.id,
              warehouseId: destWhId,
              locationId: toLoc.id,
              qty,
              referenceType: 'TRANSFER_IN',
              referenceId: transferRequest.id,
              movementType: 'TRANSFER',
              unitCost: unitPrice,
              createdAt: recvDate,
            },
          });
        }
      }

      const outMovNo = `MV-STN-OUT-${requestNo}-${row.BarCode}-${idx}`;
      await prisma.stockMovement.create({
        data: {
          movementNo: outMovNo,
          itemId: item.id,
          fromLocationId: fromLoc.id,
          toLocationId: toLoc.id,
          quantity: qty,
          type: 'TRANSFER',
          referenceType: 'TRANSFER_REQUEST',
          referenceId: transferRequest.id,
          movementDate: docDate,
          createdAt: docDate,
          notes: `STN Transfer Out: ${requestNo}`,
        },
      });

      totalSTNItems++;
    }
    importedSTNs++;
  }
  console.log(`✅ [MODULE 1] Created ${importedSTNs} Stock Transfer Requests (${totalSTNItems} item lines).`);

  // ==========================================
  // MODULE 2: Cash Sales (SI)
  // ==========================================
  console.log(`\n📦 [MODULE 2/4] Processing ${saleRows.length} Cash Sale items...`);
  const salesGroups = new Map<string, RawSaleRow[]>();
  for (const r of saleRows) {
    const key = `${r.DocumentNumber}_${r.DocumentDate}_${r['Location Code']}_${r['POS ID']}`;
    if (!salesGroups.has(key)) salesGroups.set(key, []);
    salesGroups.get(key)!.push(r);
  }

  const locSeqMap = new Map<string, number>();
  let importedSalesOrders = 0;
  let totalSalesItems = 0;
  let totalSalesRevenue = 0;

  for (const [groupKey, groupRows] of salesGroups.entries()) {
    const sample = groupRows[0];
    const location = locationCache.get(sample['Location Code'])!;
    const docDate = parseDate(sample.DocumentDate);
    const fySuffix = getFySuffix(docDate);
    const rawCode = location.shortCode?.trim() || location.code?.trim() || sample['Location Code'];
    const cleanCode = rawCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const seqKey = `${cleanCode}_${fySuffix}`;
    const seq = (locSeqMap.get(seqKey) || 0) + 1;
    locSeqMap.set(seqKey, seq);

    const orderNumber = `SI-${cleanCode}${fySuffix}-${String(seq).padStart(5, '0')}`;
    const subtotal = groupRows.reduce((acc, r) => acc + (r.Total_Price_W_O_T || (r.Price_W_O_T * r.Quantity)), 0);
    const discountAmount = groupRows.reduce((acc, r) => acc + r.DiscountAmount, 0);
    const taxAmount = groupRows.reduce((acc, r) => acc + r['Total Sales Tax'], 0);
    const grandTotal = groupRows.reduce((acc, r) => acc + r['Value Incl Sales Tax'], 0);

    totalSalesRevenue += grandTotal;

    if (isDryRun) {
      importedSalesOrders++;
      totalSalesItems += groupRows.length;
      continue;
    }

    const existingOrder = await prisma.salesOrder.findFirst({
      where: { orderNumber },
      select: { id: true },
    });

    if (existingOrder) {
      await prisma.stockMovement.deleteMany({ where: { referenceId: existingOrder.id } });
      await prisma.stockLedger.deleteMany({ where: { referenceId: existingOrder.id } });
      await prisma.salesOrderItem.deleteMany({ where: { salesOrderId: existingOrder.id } });
      await prisma.salesOrder.delete({ where: { id: existingOrder.id } });
    }

    const cashAmount = sample.CashSale || 0;
    const cardAmount = sample.CardSale || 0;
    const voucherAmount = (sample.GiftVoucherAmount || 0) + (sample.CreditVoucherAmount || 0) +
                          (sample.ExchangeVoucherAmount || 0) + (sample.ClaimVoucherAmount || 0) +
                          (sample.GiftVoucherAmount_Corporate || 0) + (sample.RewardVoucherAmount || 0);

    let paymentMethod = 'cash';
    if ((cardAmount > 0 && cashAmount > 0) || (cardAmount > 0 && voucherAmount > 0) || (cashAmount > 0 && voucherAmount > 0)) {
      paymentMethod = 'split';
    } else if (cardAmount > 0) {
      paymentMethod = 'card';
    } else if (voucherAmount > 0) {
      paymentMethod = 'voucher';
    }

    const salesOrder = await prisma.salesOrder.create({
      data: {
        orderNumber,
        posId: String(sample['POS ID']),
        locationId: location.id,
        subtotal,
        discountAmount,
        taxAmount,
        grandTotal,
        paymentMethod,
        paymentStatus: 'paid',
        status: 'completed',
        notes: `Original DocNo: ${sample.DocumentNumber} | POS ID: ${sample['POS ID']} | SalesPerson: ${sample.SalesPerson || ''}`,
        fbrInvoiceNumber: sample['FBR Invoice#'] || null,
        createdAt: docDate,
      },
    });

    let sIdx = 0;
    for (const row of groupRows) {
      sIdx++;
      const item = itemCache.get(row.BarCode);
      const qty = Math.abs(row.Quantity);
      const unitPrice = row.UnitPrice;
      const lineDiscount = row.DiscountAmount;
      const lineTax = row['Total Sales Tax'];
      const lineValExTax = row['Value Ex Sales Tax'];
      const calculatedTaxPct = lineValExTax > 0 ? Math.round((lineTax / lineValExTax) * 100 * 100) / 100 : 18;
      const lineTotal = row['Value Incl Sales Tax'];

      await prisma.salesOrderItem.create({
        data: {
          salesOrderId: salesOrder.id,
          itemId: item.id,
          quantity: qty,
          unitPrice,
          discountAmount: lineDiscount,
          taxAmount: lineTax,
          taxPercent: calculatedTaxPct,
          lineTotal,
          createdAt: docDate,
        },
      });

      const effectiveWhId = location.warehouseId || defaultWarehouse?.id;
      if (effectiveWhId) {
        await prisma.stockLedger.create({
          data: {
            itemId: item.id,
            warehouseId: effectiveWhId,
            locationId: location.id,
            qty: -qty,
            referenceType: 'POS_SALE',
            referenceId: salesOrder.id,
            movementType: 'OUTBOUND',
            unitCost: unitPrice,
            createdAt: docDate,
          },
        });
      }

      const movNo = `MV-SALE-${orderNumber}-${row.BarCode}-${sIdx}`;
      await prisma.stockMovement.create({
        data: {
          movementNo: movNo,
          itemId: item.id,
          fromLocationId: location.id,
          quantity: qty,
          type: 'SALE',
          referenceType: 'POS_SALE',
          referenceId: salesOrder.id,
          movementDate: docDate,
          createdAt: docDate,
          notes: `POS Sale #${orderNumber}`,
        },
      });

      totalSalesItems++;
    }
    importedSalesOrders++;
  }
  console.log(`✅ [MODULE 2] Created ${importedSalesOrders} Cash Sales Orders (${totalSalesItems} item lines, Total: PKR ${totalSalesRevenue.toLocaleString()}).`);

  // ==========================================
  // MODULE 3: Sales Returns & Vouchers
  // ==========================================
  console.log(`\n📦 [MODULE 3/4] Processing ${returnRows.length} Sales Return items...`);
  const returnGroups = new Map<string, RawReturnRow[]>();
  for (const r of returnRows) {
    const key = `${r.DocumentNumber}_${r.DocumentDate}_${r['Location Code']}`;
    if (!returnGroups.has(key)) returnGroups.set(key, []);
    returnGroups.get(key)!.push(r);
  }

  let importedReturns = 0;
  let totalReturnItems = 0;
  let totalVoucherValue = 0;

  for (const [groupKey, groupRows] of returnGroups.entries()) {
    const sample = groupRows[0];
    const location = locationCache.get(sample['Location Code'])!;
    const docDate = parseDate(sample.DocumentDate);
    const rawCode = location.shortCode?.trim() || location.code?.trim() || sample['Location Code'];
    const cleanCode = rawCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const padDocNo = String(sample.DocumentNumber).padStart(5, '0');

    const subTypePrefix = sample['SUB Type'].toUpperCase() === 'CLAIM' ? 'CLM' :
                          sample['SUB Type'].toUpperCase() === 'REFUND' ? 'REF' : 'EXC';
    const voucherCode = `${subTypePrefix}-${cleanCode}-${padDocNo}`;
    const returnTotalValue = groupRows.reduce((acc, r) => acc + Math.abs(r['Value Incl Sales Tax']), 0);
    totalVoucherValue += returnTotalValue;
    const isRedeemed = Boolean(sample.FKInvoiceNumber_Settle);

    const voucherType = sample['SUB Type'].toUpperCase() === 'CLAIM' ? 'CLAIM' :
                        sample['SUB Type'].toUpperCase() === 'REFUND' ? 'REFUND' : 'EXCHANGE';

    if (isDryRun) {
      importedReturns++;
      totalReturnItems += groupRows.length;
      continue;
    }

    let originalSalesOrder: any = null;
    if (sample.FKInvoiceNumber_Sale) {
      const saleDoc = String(sample.FKInvoiceNumber_Sale).trim();
      const paddedSaleDoc = saleDoc.padStart(5, '0');
      originalSalesOrder = await prisma.salesOrder.findFirst({
        where: {
          OR: [
            { orderNumber: { endsWith: `-${paddedSaleDoc}` } },
            { orderNumber: { endsWith: `-${saleDoc}` } },
            { notes: { contains: `DocNo: ${saleDoc}` } },
          ],
        },
        select: { id: true, orderNumber: true },
      });
    }

    let targetOrderId: string;

    if (originalSalesOrder) {
      targetOrderId = originalSalesOrder.id;
      await prisma.salesOrder.update({
        where: { id: originalSalesOrder.id },
        data: { status: 'returned', returnNumber: voucherCode },
      });
    } else {
      const returnOrderNumber = `RET-${cleanCode}-${padDocNo}`;
      const retSubtotal = groupRows.reduce((acc, r) => acc + Math.abs(r.Total_Price_W_O_T || r.Price_W_O_T), 0);
      const retDiscountAmount = groupRows.reduce((acc, r) => acc + Math.abs(r.DiscountAmount), 0);
      const retTaxAmount = groupRows.reduce((acc, r) => acc + Math.abs(r['Total Sales Tax']), 0);
      const retGrandTotal = groupRows.reduce((acc, r) => acc + Math.abs(r['Value Incl Sales Tax']), 0);

      const existingRetOrder = await prisma.salesOrder.findUnique({
        where: { orderNumber: returnOrderNumber },
        select: { id: true },
      });
      if (existingRetOrder) {
        await prisma.salesOrderItem.deleteMany({ where: { salesOrderId: existingRetOrder.id } });
        await prisma.salesOrder.delete({ where: { id: existingRetOrder.id } });
      }

      const returnSalesOrder = await prisma.salesOrder.create({
        data: {
          orderNumber: returnOrderNumber,
          returnNumber: voucherCode,
          posId: sample['POS ID'] ? String(sample['POS ID']) : null,
          locationId: location.id,
          subtotal: retSubtotal,
          discountAmount: retDiscountAmount,
          taxAmount: retTaxAmount,
          grandTotal: retGrandTotal,
          paymentMethod: 'VOUCHER',
          paymentStatus: 'paid',
          status: 'returned',
          notes: sample.Remarks || `Imported Return Doc #${sample.DocumentNumber}`,
          fbrInvoiceNumber: sample['FBR Invoice#'] || null,
          createdAt: docDate,
        },
      });

      for (const row of groupRows) {
        const item = itemCache.get(row.BarCode);
        const absQty = Math.abs(row.Quantity);
        const unitPrice = Math.abs(row.UnitPrice);
        const lineDiscountAmount = Math.abs(row.DiscountAmount);
        const lineTaxAmount = Math.abs(row['Total Sales Tax']);
        const lineValueExSalesTax = Math.abs(row['Value Ex Sales Tax']);
        const calculatedTaxPct = lineValueExSalesTax > 0 ? Math.round((lineTaxAmount / lineValueExSalesTax) * 100 * 100) / 100 : 18;
        const lineTotal = Math.abs(row['Value Incl Sales Tax']);

        await prisma.salesOrderItem.create({
          data: {
            salesOrderId: returnSalesOrder.id,
            itemId: item.id,
            quantity: absQty,
            unitPrice,
            discountAmount: lineDiscountAmount,
            taxAmount: lineTaxAmount,
            taxPercent: calculatedTaxPct,
            lineTotal,
            createdAt: docDate,
          },
        });
      }
      targetOrderId = returnSalesOrder.id;
    }

    await prisma.voucher.upsert({
      where: { code: voucherCode },
      update: {
        voucherType,
        faceValue: returnTotalValue,
        description: `Voucher for Return Doc #${sample.DocumentNumber}`,
        issuedByLocationId: location.id,
        sourceOrderId: targetOrderId,
        isActive: true,
        isRedeemed,
        createdAt: docDate,
      },
      create: {
        code: voucherCode,
        voucherType,
        faceValue: returnTotalValue,
        description: `Voucher for Return Doc #${sample.DocumentNumber}`,
        issuedByLocationId: location.id,
        sourceOrderId: targetOrderId,
        isActive: true,
        isRedeemed,
        createdAt: docDate,
      },
    });

    let rIdx = 0;
    for (const row of groupRows) {
      rIdx++;
      const item = itemCache.get(row.BarCode);
      const absQty = Math.abs(row.Quantity);
      const unitPrice = Math.abs(row.UnitPrice);

      const effectiveWhId = location.warehouseId || defaultWarehouse?.id;
      if (effectiveWhId) {
        await prisma.stockLedger.create({
          data: {
            itemId: item.id,
            warehouseId: effectiveWhId,
            locationId: location.id,
            qty: absQty,
            referenceType: 'SALES_RETURN',
            referenceId: targetOrderId,
            movementType: 'INBOUND',
            unitCost: unitPrice,
            createdAt: docDate,
          },
        });
      }

      const retMovNo = `MV-RET-${voucherCode}-${row.BarCode}-${rIdx}`;
      await prisma.stockMovement.create({
        data: {
          movementNo: retMovNo,
          itemId: item.id,
          toLocationId: location.id,
          quantity: absQty,
          type: 'RETURN',
          referenceType: 'SALES_RETURN',
          referenceId: targetOrderId,
          movementDate: docDate,
          createdAt: docDate,
          notes: `Sales Return Stock Restoration #${voucherCode}`,
        },
      });

      totalReturnItems++;
    }
    importedReturns++;
  }
  console.log(`✅ [MODULE 3] Created ${importedReturns} Return Vouchers (${totalReturnItems} items, Total Value: PKR ${totalVoucherValue.toLocaleString()}).`);

  // ==========================================
  // MODULE 4: Outstanding Credit Vouchers
  // ==========================================
  console.log(`\n📦 [MODULE 4/4] Processing ${outstandingVoucherRows.length} Outstanding Credit Vouchers...`);
  let importedOutstanding = 0;

  for (const row of outstandingVoucherRows) {
    const location = locationCache.get(row['Location Code'])!;
    const docDate = parseDate(row.DocumentDate);
    const rawCode = location.shortCode?.trim() || location.code?.trim() || row['Location Code'];
    const cleanCode = rawCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const voucherCode = `CR-${cleanCode}-${String(row.DocumentNumber).padStart(5, '0')}`;

    if (isDryRun) {
      importedOutstanding++;
      continue;
    }

    await prisma.voucher.upsert({
      where: { code: voucherCode },
      update: {
        voucherType: 'CREDIT',
        faceValue: row.Amount,
        description: `Outstanding Credit Voucher Doc #${row.DocumentNumber}`,
        issuedByLocationId: location.id,
        isActive: true,
        isRedeemed: false,
        createdAt: docDate,
      },
      create: {
        code: voucherCode,
        voucherType: 'CREDIT',
        faceValue: row.Amount,
        description: `Outstanding Credit Voucher Doc #${row.DocumentNumber}`,
        issuedByLocationId: location.id,
        isActive: true,
        isRedeemed: false,
        createdAt: docDate,
      },
    });
    importedOutstanding++;
  }
  console.log(`✅ [MODULE 4] Created/Updated ${importedOutstanding} Outstanding Credit Vouchers.`);
}

async function main() {
  console.log(`🚀 Starting Unified POS Data Importer (JSON)...`);
  console.log(`📄 Target JSON File: ${jsonPath}`);
  if (isDryRun) {
    console.log(`⚠️ DRY RUN ACTIVATED: No database changes will be committed.`);
  }

  const rawJson = fs.readFileSync(jsonPath, 'utf8');
  const jsonData = JSON.parse(rawJson);

  const transferRows = jsonData['Transfer OUT Or IN'] || [];
  const saleRows = jsonData['Sale'] || [];
  const returnRows = jsonData['Return'] || [];
  const outstandingVoucherRows = jsonData['Outstanding Credit Vouchers'] || [];

  console.log(`==================================================`);
  console.log(`📋 JSON Sections Summary:`);
  console.log(`   - Stock Transfers (STN): ${transferRows.length} items`);
  console.log(`   - Cash Sales (SI)      : ${saleRows.length} items`);
  console.log(`   - Sales Returns (RET)  : ${returnRows.length} items`);
  console.log(`   - Outstanding Vouchers : ${outstandingVoucherRows.length} items`);
  console.log(`==================================================\n`);

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (managementUrl && masterKey) {
    const mPool = new Pool({ connectionString: managementUrl });
    const mAdapter = new PrismaPg(mPool);
    const management = new ManagementClient({ adapter: mAdapter } as any);

    let companies: any[] = [];
    try {
      companies = await management.company.findMany({ where: { status: 'active' } });
    } catch (err: any) {
      console.warn(`ℹ️ Multi-tenant management check skipped (${err.message}).`);
    } finally {
      await management.$disconnect();
      await mPool.end();
    }

    if (companies.length > 0) {
      let filtered = companies;
      if (targetTenant) {
        filtered = companies.filter((c) => c.code.toLowerCase() === targetTenant.toLowerCase() || c.name.toLowerCase().includes(targetTenant.toLowerCase()));
      }

      console.log(`🏢 Found ${filtered.length} active tenant companies. Running unified import for each...`);
      for (const company of filtered) {
        console.log(`\n👉 Processing Tenant: ${company.name} (${company.code})`);
        let connectionString = company.dbUrl;
        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch (e) {
            console.warn(`  ⚠️ Password decryption failed, using dbUrl fallback`);
          }
        }
        if (!connectionString) continue;

        const pool = new Pool({ connectionString });
        const adapter = new PrismaPg(pool);
        const tenantPrisma = new PrismaClient({ adapter });

        try {
          await tenantPrisma.$connect();
          await processUnifiedTenantData(tenantPrisma, jsonData);
        } finally {
          await tenantPrisma.$disconnect();
          await pool.end();
        }
      }
      console.log(`\n==================================================`);
      console.log(`🎉 UNIFIED IMPORT COMPLETE FOR ALL TENANTS!`);
      console.log(`==================================================`);
      return;
    }
  }

  // Fallback: Primary DATABASE_URL
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL environment variable is missing.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    await prisma.$connect();
    await processUnifiedTenantData(prisma, jsonData);
    console.log(`\n==================================================`);
    console.log(`🎉 UNIFIED IMPORT COMPLETE!`);
    console.log(`==================================================`);
  } catch (error) {
    console.error('❌ Error during import:', error);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
