import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import type { Response } from 'express';

// Store codes and Staff IDs mapping for Charles & Keith and Pedro outlets
// Based on Singapore Franchisor Codes and Speed Sports Store ID configs
export const STORE_CODE_MAPPING: Record<string, { storeCode: string; staffId: number }> = {
  // CK Locations
  'CK1001': { storeCode: 'S000000419', staffId: 65 }, // C&K-DOLMEN CLIFTON
  'CK1002': { storeCode: 'S000001181', staffId: 66 }, // C&K-LUCKY ONE MALL
  'CK1003': { storeCode: 'S000000985', staffId: 68 }, // C&K-EMPORIUM MALL
  'CK1004': { storeCode: 'S000001060', staffId: 69 }, // C&K-PACKAGES MALL
  'CK1005': { storeCode: 'S000000440', staffId: 70 }, // C&K-DOLMEN LAHORE
  'CK1006': { storeCode: 'S000001812', staffId: 113 }, // C&K-CENTAURUS MALL
  
  // Pedro Locations
  'P10001': { storeCode: 'S000000404', staffId: 62 }, // PEDRO-DOLMEN CLIFTON
  'P10002': { storeCode: 'S000001385', staffId: 73 }, // PEDRO-PACKAGES MALL
  'P10003': { storeCode: 'S000001847', staffId: 114 }, // PEDRO-DOLMEN LAHORE
  'P10004': { storeCode: 'S000001427', staffId: 74 }, // PEDRO-ONLINE
  'C10005': { storeCode: 'S000000507', staffId: 75 }, // PEDRO ONLINE / CORP
};

export interface CkPedroReportRecord {
  country: string;
  date: string;
  location: string;
  article: string;
  barCode: string;
  soldQty: number;
  unitCost: number;
  grossPrice: number;
  netPrice: number;
  netpriceSGD: number;
  transactionID: string;
  staffID: number | string;
  emp_Code: number | string;
  column1: string;
  column2: string;
  price_W_O_T: number;
  total_Price_W_O_T: number;
  discountAmount: number;
  valueExSalesTax: number;
  salesTax: number;
  additionalSalesTax: number;
  totalSalesTax: number;
  valueInclSalesTax: number;
}


export interface CkPedroStockRecord {
  country: string;
  date: string;
  storeName: string;
  articleNo: string;
  barCode: string;
  batch: string;
  onHandQty: number;
  unitLandedCost: number;
  unitGrossPrice: number;
  unitNetPrice: number;
  column1: string;
}

export interface CkPedroStockTotals {
  totalRecords: number;
  totalOnHandQty: number;
  totalLandedCost: number;
  totalGrossValue: number;
}

export interface CkPedroReportTotals {
  totalRecords: number;
  totalSoldQty: number;
  totalPriceWOT: number;
  totalDiscount: number;
  totalValueExSalesTax: number;
  totalSalesTax: number;
  totalValueInclSalesTax: number;
}

@Injectable()
export class CkPedroSalesReportService {
  private readonly logger = new Logger(CkPedroSalesReportService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper to check if an article is Pedro Shoe Care or Socks (which do not receive the 1.1% factor)
   */
  private isPedroShoeCareOrSocks(sku: string, description?: string, categoryName?: string): boolean {
    const text = `${sku} ${description || ''} ${categoryName || ''}`.toLowerCase();
    const exemptKeywords = [
      'shoe care',
      'shoecare',
      'socks',
      'sock',
      'dubbin',
      'shoetree',
      'shoe tree',
      'airpillow',
      'air pillow',
      'gelheelgrip',
      'heel grip',
      'wheelcushion',
      'heel cushion',
      'cleaningblock',
      'cleaning block',
      'shoelace',
      'shoe lace',
      'shoeshine',
      'shoe shine',
      'p-airpillow',
      'p-gelheelgrip',
      'p-pwheelcushion',
      'p-shoetree',
      'pd-cleaningblock',
      'pd-dubbin',
      'pd-shoelace',
      'pd-shoeshine',
    ];
    return exemptKeywords.some((kw) => text.includes(kw));
  }

  /**
   * Calculate Unit Cost with 1.1% factor where applicable
   */
  private calculateUnitCost(
    baseCost: number,
    brandName: string,
    sku: string,
    description?: string,
    categoryName?: string,
  ): number {
    const cost = Number(baseCost) || 0;
    if (cost <= 0) return 0;

    const bName = (brandName || '').toUpperCase();
    const isPedro = bName.includes('PEDRO') || sku.toUpperCase().startsWith('P');
    
    // Pedro shoe care & socks articles do not add factor (1.1%)
    if (isPedro && this.isPedroShoeCareOrSocks(sku, description, categoryName)) {
      return Number(cost.toFixed(3));
    }

    // Both CK & Pedro get 1.1% (1 + 0.011 = 1.011) factor added
    return Number((cost * 1.011).toFixed(3));
  }

  /**
   * Generate report records from SalesOrders, PosReturns, and PosClaims
   */
  async getReportData(filters: {
    startDate?: string;
    endDate?: string;
    asOfDate?: string;
    locationId?: string;
    locationIds?: string[];
    search?: string;
  }): Promise<{ records: CkPedroReportRecord[]; totals: CkPedroReportTotals }> {
    const now = new Date();
    const asOf = filters.asOfDate;
    const startStr = asOf || filters.startDate;
    const endStr = asOf || filters.endDate;

    let startDate: Date;
    let endDate: Date;

    if (startStr) {
      const [y, m, d] = startStr.split('-').map(Number);
      startDate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    } else {
      startDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0));
    }

    if (endStr) {
      const [y, m, d] = endStr.split('-').map(Number);
      endDate = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
    } else {
      endDate = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999));
    }

    // 1. Fetch relevant Locations (C&K and Pedro stores)
    const locations = await this.prisma.location.findMany({
      select: { id: true, name: true, code: true },
    });

    const isCkOrPedroLoc = (loc: { code?: string | null; name?: string | null }) => {
      const c = (loc.code || '').toUpperCase().trim();
      const n = (loc.name || '').toUpperCase().trim();
      if (STORE_CODE_MAPPING[c]) return true;
      if (c.startsWith('CK') || (c.startsWith('P') && !c.startsWith('PU'))) return true;
      if (n.includes('C&K') || n.includes('CHARLES') || n.includes('PEDRO')) return true;
      return false;
    };

    const ckPedroLocations = locations.filter(isCkOrPedroLoc);
    const ckPedroLocationIds = ckPedroLocations.map((l) => l.id);

    // Parse requested location IDs (support single ID, comma-separated string, or array)
    const rawLocs =
      filters.locationIds && filters.locationIds.length > 0
        ? filters.locationIds
        : filters.locationId && filters.locationId !== 'all'
          ? filters.locationId
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [];

    // If specific stores are selected, use them; otherwise restrict to all CK & Pedro stores
    const targetLocIds = rawLocs.length > 0 ? rawLocs : ckPedroLocationIds;

    const locationMap = new Map<string, { storeCode: string; code: string; staffId: number | string; name: string }>();
    for (const loc of locations) {
      const code = (loc.code || '').trim().toUpperCase();
      const cfg = STORE_CODE_MAPPING[code] || {
        storeCode: loc.code ? `S000000${loc.code.replace(/\D/g, '')}` : 'S000000000',
        staffId: 0,
      };
      locationMap.set(loc.id, {
        storeCode: cfg.storeCode,
        code: code || '',
        staffId: code || cfg.staffId || '',
        name: loc.name,
      });
    }

    // 2. Fetch C&K and Pedro Brand IDs
    const brands = await this.prisma.brand.findMany({
      where: {
        OR: [
          { name: { contains: 'CHARLES', mode: 'insensitive' } },
          { name: { contains: 'PEDRO', mode: 'insensitive' } },
          { code: { in: ['IMP008', 'IMP009'] } },
        ],
      },
      select: { id: true, name: true, code: true },
    });
    const brandIds = brands.map((b) => b.id);

    // 3. Query Sales Orders
    const salesWhere: any = {
      status: { notIn: ['voided', 'cancelled', 'draft', 'hold', 'hold_expired', 'VOIDED', 'CANCELLED', 'DRAFT'] },
      createdAt: { gte: startDate, lte: endDate },
    };

    if (targetLocIds.length > 0) {
      salesWhere.locationId = targetLocIds.length === 1 ? targetLocIds[0] : { in: targetLocIds };
    }

    const salesOrders = await this.prisma.salesOrder.findMany({
      where: salesWhere,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        orderNumber: true,
        createdAt: true,
        locationId: true,
        cashierUserId: true,
        notes: true,
        items: {
          include: {
            item: {
              select: {
                id: true,
                sku: true,
                itemId: true,
                barCode: true,
                description: true,
                unitCost: true,
                fob: true,
                brandId: true,
                brand: { select: { name: true } },
                category: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    const records: CkPedroReportRecord[] = [];

    // Helper for transaction ID formatting (CM-..., EX-..., CL-...)
    const formatTxId = (prefix: string, rawNumber: string): string => {
      if (!rawNumber) return `${prefix}-01`;
      const matches = rawNumber.match(/\d+$/);
      if (matches) {
        return `${prefix}-${parseInt(matches[0], 10)}`;
      }
      return `${prefix}-${rawNumber}`;
    };

    // Query employees to map checkout salesman (cashierUserId) to employeeId
    const cashierUserIds = [
      ...new Set(salesOrders.map((o) => o.cashierUserId).filter(Boolean) as string[]),
    ];

    const employees = await this.prisma.employee.findMany({
      where: {
        OR: [
          ...(targetLocIds.length > 0 ? [{ locationId: { in: targetLocIds } }] : []),
          ...(cashierUserIds.length > 0
            ? [{ id: { in: cashierUserIds } }, { userId: { in: cashierUserIds } }]
            : []),
        ],
      },
      select: {
        id: true,
        userId: true,
        employeeId: true,
        employeeName: true,
      },
    });

    const employeeMap = new Map<string, { employeeId: string; name: string }>();
    for (const emp of employees) {
      const info = {
        employeeId: emp.employeeId || '',
        name: emp.employeeName || '',
      };
      employeeMap.set(emp.id, info);
      if (emp.userId) {
        employeeMap.set(emp.userId, info);
      }
    }

    // Helper to get salesperson employee ID (selected at checkout)
    const getSalespersonCode = (
      cashierUserId?: string | null,
      notes?: string | null,
      defaultStaffId: number | string = '',
    ): string | number => {
      if (cashierUserId && employeeMap.has(cashierUserId)) {
        const emp = employeeMap.get(cashierUserId);
        if (emp?.employeeId) return emp.employeeId;
      }
      if (notes) {
        const codeMatch = notes.match(/Emp_Code:\s*(\S+)/i) || notes.match(/EmpCode:\s*(\S+)/i);
        if (codeMatch) return codeMatch[1];
      }
      return defaultStaffId || '';
    };

    // 4. Process Sales Orders
    for (const order of salesOrders) {
      const locInfo = order.locationId ? locationMap.get(order.locationId) : null;
      const storeCode = locInfo?.storeCode || 'S000000000';
      const staffId = locInfo?.code || locInfo?.staffId || '';
      const empCode = getSalespersonCode(order.cashierUserId, order.notes, staffId);
      const txDate = order.createdAt ? new Date(order.createdAt).toISOString().split('T')[0] : '';
      const txId = order.orderNumber;

      // Group items on the same order with same article/barcode
      const itemGroups = new Map<string, {
        item: any;
        qty: number;
        unitPrice: number;
        discountAmount: number;
        taxAmount: number;
        taxPercent: number;
        lineTotal: number;
      }>();

      for (const soi of order.items) {
        const it = soi.item;
        if (!it) continue;

        // Filter: only C&K and Pedro items
        const bName = it.brand?.name || '';
        const isCkOrPedro = brandIds.includes(it.brandId || '') ||
          bName.toUpperCase().includes('CHARLES') ||
          bName.toUpperCase().includes('PEDRO') ||
          (it.sku && (it.sku.toUpperCase().startsWith('CK') || it.sku.toUpperCase().startsWith('P')));

        if (!isCkOrPedro) continue;

        const articleCode = it.sku || it.itemId || 'N/A';
        const barCode = it.barCode || it.sku || '';
        const groupKey = `${articleCode}|${barCode}`;

        const qty = soi.quantity || 1;
        const uPrice = Number(soi.unitPrice) || 0;
        const disc = Number(soi.discountAmount) || 0;
        const tax = Number(soi.taxAmount) || 0;
        const taxPct = Number(soi.taxPercent) || (tax > 0 ? 25 : 0);
        const lTotal = Number(soi.lineTotal) || (uPrice * qty - disc + tax);

        const existing = itemGroups.get(groupKey);
        if (existing) {
          existing.qty += qty;
          existing.discountAmount += disc;
          existing.taxAmount += tax;
          existing.lineTotal += lTotal;
        } else {
          itemGroups.set(groupKey, {
            item: it,
            qty,
            unitPrice: uPrice,
            discountAmount: disc,
            taxAmount: tax,
            taxPercent: taxPct,
            lineTotal: lTotal,
          });
        }
      }

      // Convert grouped items into report rows
      for (const [key, g] of itemGroups.entries()) {
        const it = g.item;
        const article = it.sku || it.itemId || 'N/A';
        const barCode = it.barCode || it.sku || '';
        const brandName = it.brand?.name || (article.startsWith('CK') ? 'CHARLES & KEITH' : 'PEDRO');
        const catName = it.category?.name || '';

        const baseCost = Number(it.unitCost) > 0 ? Number(it.unitCost) : Number(it.fob) || 0;
        const unitCost = this.calculateUnitCost(baseCost, brandName, article, it.description, catName);

        const soldQty = g.qty;
        const taxRate = g.taxPercent > 0 ? g.taxPercent / 100 : 0.25;

        // Value without sales tax calculations
        const priceWOT = Number((g.unitPrice / (1 + taxRate)).toFixed(2));
        const totalPriceWOT = Number((priceWOT * soldQty).toFixed(2));
        
        const discountAmt = Number(g.discountAmount.toFixed(2));
        const discWOT = Number((discountAmt / (1 + taxRate)).toFixed(2));

        const valueExTax = Number((totalPriceWOT - discWOT).toFixed(2));
        const grossPrice = priceWOT;
        const netPrice = soldQty > 0 ? Number((valueExTax / soldQty).toFixed(2)) : valueExTax;

        const salesTax = Number((valueExTax * taxRate).toFixed(2));
        const totalSalesTax = salesTax;
        const valueInclSalesTax = Number((valueExTax + salesTax).toFixed(2));

        records.push({
          country: 'Pakistan',
          date: txDate,
          location: storeCode,
          article,
          barCode,
          soldQty,
          unitCost,
          grossPrice,
          netPrice,
          netpriceSGD: 0,
          transactionID: txId,
          staffID: staffId,
          emp_Code: empCode,
          column1: '',
          column2: '',
          price_W_O_T: priceWOT,
          total_Price_W_O_T: totalPriceWOT,
          discountAmount: discWOT,
          valueExSalesTax: valueExTax,
          salesTax,
          additionalSalesTax: 0,
          totalSalesTax,
          valueInclSalesTax,
        });
      }
    }

    // 5. Query POS Returns & Exchanges (prefix EX-)
    const returnsWhere: any = {
      createdAt: { gte: startDate, lte: endDate },
    };
    if (targetLocIds.length > 0) {
      returnsWhere.locationId = targetLocIds.length === 1 ? targetLocIds[0] : { in: targetLocIds };
    }

    const posReturns = await this.prisma.posReturn.findMany({
      where: returnsWhere,
      orderBy: { createdAt: 'asc' },
      include: {
        items: {
          include: {
            item: {
              select: {
                id: true,
                sku: true,
                itemId: true,
                barCode: true,
                description: true,
                unitCost: true,
                fob: true,
                brandId: true,
                brand: { select: { name: true } },
                category: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    for (const ret of posReturns) {
      const locInfo = ret.locationId ? locationMap.get(ret.locationId) : null;
      const storeCode = locInfo?.storeCode || 'S000000000';
      const staffId = locInfo?.code || locInfo?.staffId || '';
      const empCode = getSalespersonCode(ret.cashierUserId, null, staffId);
      const txDate = ret.createdAt ? new Date(ret.createdAt).toISOString().split('T')[0] : '';
      const txId = ret.returnNumber || formatTxId('EX', ret.returnNumber);

      for (const ri of ret.items) {
        const it = ri.item;
        if (!it) continue;

        const bName = it.brand?.name || '';
        const isCkOrPedro = brandIds.includes(it.brandId || '') ||
          bName.toUpperCase().includes('CHARLES') ||
          bName.toUpperCase().includes('PEDRO') ||
          (it.sku && (it.sku.toUpperCase().startsWith('CK') || it.sku.toUpperCase().startsWith('P')));

        if (!isCkOrPedro) continue;

        const article = it.sku || it.itemId || 'N/A';
        const barCode = it.barCode || it.sku || '';
        const brandName = it.brand?.name || (article.startsWith('CK') ? 'CHARLES & KEITH' : 'PEDRO');
        const catName = it.category?.name || '';

        const baseCost = Number(it.unitCost) > 0 ? Number(it.unitCost) : Number(it.fob) || 0;
        const unitCost = this.calculateUnitCost(baseCost, brandName, article, it.description, catName);

        const qty = ri.quantity || 1;
        const soldQty = -qty; // Negative for return / exchange
        const taxRate = 0.25;

        const uPrice = Number(ri.originalUnitPrice || ri.unitPriceWost || 0);
        const priceWOT = Number((uPrice / (1 + taxRate)).toFixed(2));
        const totalPriceWOT = -Number((priceWOT * qty).toFixed(2));

        const discWOT = -Number((Number(ri.discountWost || 0)).toFixed(2));
        const valueExTax = Number((totalPriceWOT - discWOT).toFixed(2));
        const grossPrice = priceWOT;
        const netPrice = Number((Math.abs(valueExTax) / qty).toFixed(2));

        const salesTax = Number((valueExTax * taxRate).toFixed(2));
        const totalSalesTax = salesTax;
        const valueInclSalesTax = Number((valueExTax + salesTax).toFixed(2));

        records.push({
          country: 'Pakistan',
          date: txDate,
          location: storeCode,
          article,
          barCode,
          soldQty,
          unitCost,
          grossPrice,
          netPrice,
          netpriceSGD: 0,
          transactionID: txId,
          staffID: staffId,
          emp_Code: empCode,
          column1: '',
          column2: '',
          price_W_O_T: -priceWOT,
          total_Price_W_O_T: totalPriceWOT,
          discountAmount: discWOT,
          valueExSalesTax: valueExTax,
          salesTax,
          additionalSalesTax: 0,
          totalSalesTax,
          valueInclSalesTax,
        });
      }
    }

    // 6. Query POS Claims (prefix CL-)
    const claimsWhere: any = {
      createdAt: { gte: startDate, lte: endDate },
    };

    const posClaims = await this.prisma.posClaim.findMany({
      where: claimsWhere,
      orderBy: { createdAt: 'asc' },
      include: {
        salesOrder: {
          select: { locationId: true, cashierUserId: true },
        },
        items: {
          include: {
            item: {
              select: {
                id: true,
                sku: true,
                itemId: true,
                barCode: true,
                description: true,
                unitCost: true,
                fob: true,
                brandId: true,
                brand: { select: { name: true } },
                category: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    for (const clm of posClaims) {
      const orderLocationId = clm.salesOrder?.locationId;
      if (orderLocationId && !targetLocIds.includes(orderLocationId)) {
        continue;
      }

      const locInfo = orderLocationId ? locationMap.get(orderLocationId) : null;
      const storeCode = locInfo?.storeCode || 'S000000000';
      const staffId = locInfo?.code || locInfo?.staffId || '';
      const empCode = getSalespersonCode(clm.salesOrder?.cashierUserId, null, staffId);
      const txDate = clm.createdAt ? new Date(clm.createdAt).toISOString().split('T')[0] : '';
      const txId = clm.claimNumber || formatTxId('CL', clm.claimNumber);

      for (const ci of clm.items) {
        const it = ci.item;
        if (!it) continue;

        const bName = it.brand?.name || '';
        const isCkOrPedro = brandIds.includes(it.brandId || '') ||
          bName.toUpperCase().includes('CHARLES') ||
          bName.toUpperCase().includes('PEDRO') ||
          (it.sku && (it.sku.toUpperCase().startsWith('CK') || it.sku.toUpperCase().startsWith('P')));

        if (!isCkOrPedro) continue;

        const article = it.sku || it.itemId || 'N/A';
        const barCode = it.barCode || it.sku || '';
        const brandName = it.brand?.name || (article.startsWith('CK') ? 'CHARLES & KEITH' : 'PEDRO');
        const catName = it.category?.name || '';

        const baseCost = Number(it.unitCost) > 0 ? Number(it.unitCost) : Number(it.fob) || 0;
        const unitCost = this.calculateUnitCost(baseCost, brandName, article, it.description, catName);

        const qty = ci.claimedQty || 1;
        const soldQty = -qty;
        const taxRate = 0.25;

        const uPrice = Number(ci.unitPaidPrice || (ci.claimedAmount ? Number(ci.claimedAmount) / qty : 0)) || 0;
        const priceWOT = Number((uPrice / (1 + taxRate)).toFixed(2));
        const totalPriceWOT = -Number((priceWOT * qty).toFixed(2));
        const discWOT = 0;
        const valueExTax = totalPriceWOT;
        const grossPrice = priceWOT;
        const netPrice = priceWOT;
        const salesTax = Number((valueExTax * taxRate).toFixed(2));
        const totalSalesTax = salesTax;
        const valueInclSalesTax = Number((valueExTax + salesTax).toFixed(2));

        records.push({
          country: 'Pakistan',
          date: txDate,
          location: storeCode,
          article,
          barCode,
          soldQty,
          unitCost,
          grossPrice,
          netPrice,
          netpriceSGD: 0,
          transactionID: txId,
          staffID: staffId,
          emp_Code: empCode,
          column1: '',
          column2: '',
          price_W_O_T: -priceWOT,
          total_Price_W_O_T: totalPriceWOT,
          discountAmount: discWOT,
          valueExSalesTax: valueExTax,
          salesTax,
          additionalSalesTax: 0,
          totalSalesTax,
          valueInclSalesTax,
        });
      }
    }

    // Calculate totals
    const totals: CkPedroReportTotals = {
      totalRecords: records.length,
      totalSoldQty: records.reduce((s, r) => s + r.soldQty, 0),
      totalPriceWOT: Number(records.reduce((s, r) => s + r.total_Price_W_O_T, 0).toFixed(2)),
      totalDiscount: Number(records.reduce((s, r) => s + r.discountAmount, 0).toFixed(2)),
      totalValueExSalesTax: Number(records.reduce((s, r) => s + r.valueExSalesTax, 0).toFixed(2)),
      totalSalesTax: Number(records.reduce((s, r) => s + r.totalSalesTax, 0).toFixed(2)),
      totalValueInclSalesTax: Number(records.reduce((s, r) => s + r.valueInclSalesTax, 0).toFixed(2)),
    };

    return { records, totals };
  }

  /**
   * Stream Excel workbook matching exact format of CK_Pedro_Sale.xlsx
   */
  async streamExcelReport(
    filters: { startDate?: string; endDate?: string; asOfDate?: string; locationId?: string; locationIds?: string[]; search?: string },
    res: Response,
  ): Promise<void> {
    const { records } = await this.getReportData(filters);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Antigravity ERP';
    workbook.lastModifiedBy = 'Speed Sports Management';
    workbook.created = new Date();
    workbook.modified = new Date();

    const ws = workbook.addWorksheet('Sheet1', {
      views: [{ showGridLines: true }],
    });

    const reportDate = filters.asOfDate || filters.startDate || new Date().toISOString().split('T')[0];

    // Top metadata rows matching CK_Pedro_Sale.xlsx Sheet1:
    const row1 = ws.addRow(['Date:', reportDate]);
    row1.font = { name: 'Calibri', size: 11, bold: true };
    ws.addRow([]); // Row 2: Empty
    const row3 = ws.addRow(['CK Pedro Sale']); // Row 3: Title
    row3.font = { name: 'Calibri', size: 14, bold: true };
    ws.addRow([]); // Row 4: Empty

    // Headers in Row 5
    const headers = [
      'Country',
      'Date',
      'Location',
      'Article',
      'BarCode',
      'SoldQty',
      'UnitCost',
      'GrossPrice',
      'NetPrice',
      'NetpriceSGD',
      'TransactionID',
      'StaffID',
      'Emp_Code',
      'Column1',
      'Column2',
      'Price_W_O_T',
      'Total_Price_W_O_T',
      'DiscountAmount',
      'Value Ex Sales Tax',
      'Sales Tax',
      'Additional Sales Tax',
      'Total Sales Tax',
      'Value Incl Sales Tax',
    ];

    const headerRow = ws.addRow(headers);
    headerRow.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E79' },
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

    // Column definitions
    ws.columns = [
      { width: 14 }, // Country
      { width: 14 }, // Date
      { width: 16 }, // Location
      { width: 18 }, // Article
      { width: 18 }, // BarCode
      { width: 10 }, // SoldQty
      { width: 14 }, // UnitCost
      { width: 14 }, // GrossPrice
      { width: 14 }, // NetPrice
      { width: 14 }, // NetpriceSGD
      { width: 16 }, // TransactionID
      { width: 10 }, // StaffID
      { width: 12 }, // Emp_Code
      { width: 10 }, // Column1
      { width: 10 }, // Column2
      { width: 16 }, // Price_W_O_T
      { width: 18 }, // Total_Price_W_O_T
      { width: 16 }, // DiscountAmount
      { width: 18 }, // Value Ex Sales Tax
      { width: 14 }, // Sales Tax
      { width: 18 }, // Additional Sales Tax
      { width: 16 }, // Total Sales Tax
      { width: 20 }, // Value Incl Sales Tax
    ];

    // Data rows
    for (const r of records) {
      const row = ws.addRow([
        r.country,
        r.date,
        r.location,
        r.article,
        r.barCode,
        r.soldQty,
        r.unitCost,
        r.grossPrice,
        r.netPrice,
        r.netpriceSGD,
        r.transactionID,
        r.staffID,
        r.emp_Code,
        r.column1,
        r.column2,
        r.price_W_O_T,
        r.total_Price_W_O_T,
        r.discountAmount,
        r.valueExSalesTax,
        r.salesTax,
        r.additionalSalesTax,
        r.totalSalesTax,
        r.valueInclSalesTax,
      ]);

      row.getCell(1).alignment = { horizontal: 'left' };
      row.getCell(2).alignment = { horizontal: 'center' };
      row.getCell(3).alignment = { horizontal: 'center' };
      row.getCell(4).alignment = { horizontal: 'left' };
      row.getCell(5).alignment = { horizontal: 'left' };
      row.getCell(6).alignment = { horizontal: 'right' };
      row.getCell(6).numFmt = '#,##0';
      row.getCell(7).numFmt = '#,##0.000';
      row.getCell(8).numFmt = '#,##0.00';
      row.getCell(9).numFmt = '#,##0.00';
      row.getCell(10).numFmt = '#,##0';
      row.getCell(11).alignment = { horizontal: 'center' };
      row.getCell(12).alignment = { horizontal: 'center' };
      row.getCell(13).alignment = { horizontal: 'center' };
      row.getCell(16).numFmt = '#,##0.00';
      row.getCell(17).numFmt = '#,##0.00';
      row.getCell(18).numFmt = '#,##0.00';
      row.getCell(19).numFmt = '#,##0.00';
      row.getCell(20).numFmt = '#,##0.00';
      row.getCell(21).numFmt = '#,##0';
      row.getCell(22).numFmt = '#,##0.00';
      row.getCell(23).numFmt = '#,##0.00';
    }

    const fileName = `CK_Pedro_Sale_${reportDate}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    res.end();
  }

  /**
   * Generate stock report records from InventoryItem matching CK_Pedro_Stock.xlsx
   */
  async getStockReportData(filters: {
    asOfDate?: string;
    locationId?: string;
    locationIds?: string[];
    search?: string;
  }): Promise<{ records: CkPedroStockRecord[]; totals: CkPedroStockTotals }> {
    const today = new Date().toISOString().split('T')[0];
    const asOfDate = filters.asOfDate || today;

    // 1. Fetch relevant Locations (C&K and Pedro stores)
    const locations = await this.prisma.location.findMany({
      select: { id: true, name: true, code: true },
    });

    const isCkOrPedroLoc = (loc: { code?: string | null; name?: string | null }) => {
      const c = (loc.code || '').toUpperCase().trim();
      const n = (loc.name || '').toUpperCase().trim();
      if (STORE_CODE_MAPPING[c]) return true;
      if (c.startsWith('CK') || (c.startsWith('P') && !c.startsWith('PU'))) return true;
      if (n.includes('C&K') || n.includes('CHARLES') || n.includes('PEDRO')) return true;
      return false;
    };

    const ckPedroLocations = locations.filter(isCkOrPedroLoc);
    const ckPedroLocationIds = ckPedroLocations.map((l) => l.id);

    const rawLocs =
      filters.locationIds && filters.locationIds.length > 0
        ? filters.locationIds
        : filters.locationId && filters.locationId !== 'all'
          ? filters.locationId
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [];

    const targetLocIds = rawLocs.length > 0 ? rawLocs : ckPedroLocationIds;

    const locationMap = new Map<string, { storeCode: string; displayLocation: string; name: string }>();
    for (const loc of locations) {
      const code = (loc.code || '').trim().toUpperCase();
      const cfg = STORE_CODE_MAPPING[code] || {
        storeCode: loc.code ? `S000000${loc.code.replace(/\D/g, '')}` : 'S000000000',
      };
      const displayLocation = code ? `${code} - ${cfg.storeCode}` : cfg.storeCode;
      locationMap.set(loc.id, {
        storeCode: cfg.storeCode,
        displayLocation,
        name: loc.name,
      });
    }

    // 2. Fetch C&K and Pedro Brand IDs
    const brands = await this.prisma.brand.findMany({
      where: {
        OR: [
          { name: { contains: 'CHARLES', mode: 'insensitive' } },
          { name: { contains: 'PEDRO', mode: 'insensitive' } },
          { code: { in: ['IMP008', 'IMP009'] } },
        ],
      },
      select: { id: true, name: true, code: true },
    });
    const brandIds = brands.map((b) => b.id);

    // 3. Query inventory items:
    // If asOfDate is today or future, query current live InventoryItem.
    // If asOfDate is a historical date, calculate available stock from StockLedger as of that date!
    const [y, m, d] = asOfDate.split('-').map(Number);
    const asOfDateTime = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
    const isTodayOrFuture = asOfDate >= today;

    let invGroups: { itemId: string; locationId: string; quantity: number }[];

    if (isTodayOrFuture) {
      const rawGroups = await this.prisma.inventoryItem.groupBy({
        by: ['itemId', 'locationId'],
        where: {
          locationId: targetLocIds.length === 1 ? targetLocIds[0] : { in: targetLocIds },
        },
        _sum: { quantity: true },
        having: {
          quantity: {
            _sum: { gt: 0 },
          },
        },
        orderBy: {
          itemId: 'asc',
        },
      });
      invGroups = rawGroups.map((g) => ({
        itemId: g.itemId,
        locationId: g.locationId,
        quantity: Number(g._sum.quantity || 0),
      }));
    } else {
      const rawGroups = await this.prisma.stockLedger.groupBy({
        by: ['itemId', 'locationId'],
        where: {
          locationId: targetLocIds.length === 1 ? targetLocIds[0] : { in: targetLocIds },
          createdAt: { lte: asOfDateTime },
        },
        _sum: { qty: true },
        having: {
          qty: {
            _sum: { gt: 0 },
          },
        },
        orderBy: {
          itemId: 'asc',
        },
      });
      invGroups = rawGroups.map((g) => ({
        itemId: g.itemId,
        locationId: g.locationId!,
        quantity: Number(g._sum.qty || 0),
      }));
    }

    const itemIds = [...new Set(invGroups.map((g) => g.itemId))];
    const items = await this.prisma.item.findMany({
      where: { id: { in: itemIds } },
      select: {
        id: true,
        sku: true,
        itemId: true,
        barCode: true,
        description: true,
        unitCost: true,
        fob: true,
        unitPrice: true,
        brandId: true,
        brand: { select: { name: true } },
        category: { select: { name: true } },
      },
    });

    const itemMap = new Map(items.map((i) => [i.id, i]));
    const records: CkPedroStockRecord[] = [];

    for (const group of invGroups) {
      const it = itemMap.get(group.itemId);
      if (!it) continue;

      // Filter: must be C&K or Pedro item
      const bName = it.brand?.name || '';
      const isCkOrPedro = brandIds.includes(it.brandId || '') ||
        bName.toUpperCase().includes('CHARLES') ||
        bName.toUpperCase().includes('PEDRO') ||
        (it.sku && (it.sku.toUpperCase().startsWith('CK') || it.sku.toUpperCase().startsWith('P')));

      if (!isCkOrPedro) continue;

      const locInfo = group.locationId ? locationMap.get(group.locationId) : null;
      const storeCode = locInfo?.displayLocation || locInfo?.storeCode || 'S000000000';
      const articleNo = it.sku || it.itemId || 'N/A';
      const barCode = it.barCode || it.sku || '';
      const brandName = it.brand?.name || (articleNo.startsWith('CK') ? 'CHARLES & KEITH' : 'PEDRO');
      const catName = it.category?.name || '';

      const baseCost = Number(it.unitCost) > 0 ? Number(it.unitCost) : Number(it.fob) || 0;
      const unitLandedCost = this.calculateUnitCost(baseCost, brandName, articleNo, it.description, catName);

      const onHandQty = group.quantity;
      const retailPrice = Number(it.unitPrice) || 0;
      const unitGrossPrice = Number((retailPrice / 1.18).toFixed(2));
      const unitNetPrice = unitGrossPrice;

      records.push({
        country: 'Pakistan',
        date: asOfDate,
        storeName: storeCode,
        articleNo,
        barCode,
        batch: '',
        onHandQty,
        unitLandedCost,
        unitGrossPrice,
        unitNetPrice,
        column1: '',
      });
    }

    // Sort by storeName and articleNo
    records.sort((a, b) => a.storeName.localeCompare(b.storeName) || a.articleNo.localeCompare(b.articleNo));

    const totals: CkPedroStockTotals = {
      totalRecords: records.length,
      totalOnHandQty: records.reduce((s, r) => s + r.onHandQty, 0),
      totalLandedCost: Number(records.reduce((s, r) => s + r.unitLandedCost * r.onHandQty, 0).toFixed(2)),
      totalGrossValue: Number(records.reduce((s, r) => s + r.unitGrossPrice * r.onHandQty, 0).toFixed(2)),
    };

    return { records, totals };
  }

  /**
   * Stream Excel workbook matching exact format of CK_Pedro_Stock.xlsx
   */
  async streamStockExcelReport(
    filters: { asOfDate?: string; locationId?: string; locationIds?: string[]; search?: string },
    res: Response,
  ): Promise<void> {
    const { records } = await this.getStockReportData(filters);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Antigravity ERP';
    workbook.lastModifiedBy = 'Speed Sports Management';
    workbook.created = new Date();
    workbook.modified = new Date();

    const ws = workbook.addWorksheet('Sheet1', {
      views: [{ showGridLines: true }],
    });

    const reportDate = filters.asOfDate || new Date().toISOString().split('T')[0];

    // Row 1: Title (matching CK_Pedro_Stock.xlsx Sheet1)
    const row1 = ws.addRow(['CK Pedro Stock ']);
    row1.font = { name: 'Calibri', size: 14, bold: true };
    ws.addRow([]); // Row 2: Empty

    // Row 3: Headers
    const headers = [
      'Country',
      'Date',
      'StoreName',
      'ArticleNo',
      'BarCode',
      'Batch',
      'OnHandQty',
      'UnitLandedCost',
      'UnitGrossPrice',
      'UnitNetPrice',
      'Column1',
    ];

    const headerRow = ws.addRow(headers);
    headerRow.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E79' },
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

    ws.columns = [
      { width: 14 }, // Country
      { width: 14 }, // Date
      { width: 16 }, // StoreName
      { width: 22 }, // ArticleNo
      { width: 20 }, // BarCode
      { width: 10 }, // Batch
      { width: 12 }, // OnHandQty
      { width: 16 }, // UnitLandedCost
      { width: 16 }, // UnitGrossPrice
      { width: 16 }, // UnitNetPrice
      { width: 10 }, // Column1
    ];

    for (const r of records) {
      const row = ws.addRow([
        r.country,
        r.date,
        r.storeName,
        r.articleNo,
        `	${r.barCode}`,
        r.batch,
        r.onHandQty,
        r.unitLandedCost,
        r.unitGrossPrice,
        r.unitNetPrice,
        r.column1,
      ]);

      row.getCell(1).alignment = { horizontal: 'left' };
      row.getCell(2).alignment = { horizontal: 'center' };
      row.getCell(3).alignment = { horizontal: 'center' };
      row.getCell(4).alignment = { horizontal: 'left' };
      row.getCell(5).alignment = { horizontal: 'left' };
      row.getCell(6).alignment = { horizontal: 'center' };
      row.getCell(7).alignment = { horizontal: 'right' };
      row.getCell(7).numFmt = '#,##0';
      row.getCell(8).alignment = { horizontal: 'right' };
      row.getCell(8).numFmt = '#,##0.000';
      row.getCell(9).alignment = { horizontal: 'right' };
      row.getCell(9).numFmt = '#,##0.00';
      row.getCell(10).alignment = { horizontal: 'right' };
      row.getCell(10).numFmt = '#,##0.00';
    }

    const fileName = `CK_Pedro_Stock_${reportDate}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    res.end();
  }

}
