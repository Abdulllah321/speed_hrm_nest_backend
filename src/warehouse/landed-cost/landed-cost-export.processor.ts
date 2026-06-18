import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

export interface LandedCostExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  landedCostId: string;
  search?: string;
  hsCodes?: string[];
  skus?: string[];
}

const SUBHEADER_BG = '334155';
const SUBHEADER_FG = 'F1F5F9';
const ALT_ROW_BG   = 'F8FAFC';
const BORDER_COLOR = 'CBD5E1';
const CURRENCY_FG  = '0F766E';
const TOTALS_BG    = 'E2E8F0';

const GROUP_COLORS: Record<string, string> = {
  'Shipment & Item Details': '1E293B',
  'Assessable Value':        '1D4ED8',
  'Duty & Tax Calculation':  'B45309',
  'Freight':                 '6D28D9',
  'MIS Breakdown (Shares)':  '047857',
  'Total Valuations':        '4338CA',
};

@Processor('landed-cost-export')
export class LandedCostExportProcessor {
  private readonly logger = new Logger(LandedCostExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
  ) {}

  @Process()
  async handleExport(job: Job<LandedCostExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, landedCostId, search, hsCodes, skus } = job.data;

    this.logger.log(`[LandedCostExport ${jobId}] Starting for user ${userId}, LandedCost: ${landedCostId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const filePath = path.join(exportDir, `export-${jobId}.xlsx`);

    try {
      // 1. Fetch Landed Cost metadata and items
      const landedCost = await prisma.landedCost.findUnique({
        where: { id: landedCostId },
        include: {
          grn: {
            include: {
              purchaseOrder: true,
            },
          },
          supplier: true,
          items: {
            include: {
              item: true,
            },
          },
        },
      });

      if (!landedCost) {
        throw new Error(`Landed cost with ID ${landedCostId} not found`);
      }

      const isLocalPurchase = landedCost.grn?.purchaseOrder?.orderType === 'LOCAL';

      // 2. Filter items based on criteria from frontend
      let filteredItems = landedCost.items;

      if (search) {
        const s = search.toLowerCase().trim();
        filteredItems = filteredItems.filter(
          (item) =>
            (item.sku || '').toLowerCase().includes(s) ||
            (item.description || '').toLowerCase().includes(s),
        );
      }

      if (hsCodes && hsCodes.length > 0) {
        filteredItems = filteredItems.filter(
          (item) => item.hsCode && hsCodes.includes(item.hsCode),
        );
      }

      if (skus && skus.length > 0) {
        filteredItems = filteredItems.filter(
          (item) => item.sku && skus.includes(item.sku),
        );
      }

      const total = filteredItems.length;
      this.logger.log(`[LandedCostExport ${jobId}] ${total} items to export`);

      // 3. Build column list depending on Local vs Import
      const COLUMNS_COMMON_DETAILS = [
        { header: 'LC#', key: 'lcNo', width: 15, group: 'Shipment & Item Details', align: 'center' },
        { header: 'BL#', key: 'blNo', width: 15, group: 'Shipment & Item Details', align: 'center' },
        { header: 'BL Date', key: 'blDate', width: 12, group: 'Shipment & Item Details', align: 'center', numFmt: 'dd-mmm-yy' },
        { header: 'GD#', key: 'gdNo', width: 15, group: 'Shipment & Item Details', align: 'center' },
        { header: 'Origin', key: 'countryOfOrigin', width: 12, group: 'Shipment & Item Details', align: 'center' },
        { header: 'Season', key: 'season', width: 12, group: 'Shipment & Item Details', align: 'center' },
        { header: 'Cat', key: 'category', width: 12, group: 'Shipment & Item Details', align: 'center' },
        { header: 'S.Inv', key: 'shippingInvoiceNo', width: 15, group: 'Shipment & Item Details', align: 'center' },
        { header: 'Date', key: 'shippingInvoiceDate', width: 12, group: 'Shipment & Item Details', align: 'center', numFmt: 'dd-mmm-yy' },
        { header: 'SKU', key: 'sku', width: 18, group: 'Shipment & Item Details', align: 'left' },
        { header: 'Description', key: 'description', width: 30, group: 'Shipment & Item Details', align: 'left' },
        { header: 'HS Code', key: 'hsCode', width: 12, group: 'Shipment & Item Details', align: 'center' },
      ];

      const COLUMNS_COMMON_AV = [
        { header: 'Qty', key: 'qty', width: 12, group: 'Assessable Value', align: 'right', numFmt: '#,##0' },
        { header: isLocalPurchase ? 'FOB PKR' : 'FOB Foreign', key: 'unitFob', width: 14, group: 'Assessable Value', align: 'right', numFmt: '#,##0' },
        { header: isLocalPurchase ? 'Inv PKR' : 'Inv Foreign', key: 'invoiceForeign', width: 14, group: 'Assessable Value', align: 'right', numFmt: '#,##0' },
        { header: 'Freight USD', key: 'freightForeign', width: 14, group: 'Assessable Value', align: 'right', numFmt: '#,##0' },
        { header: 'Ex Rate', key: 'exchangeRate', width: 10, group: 'Assessable Value', align: 'right', numFmt: '0.00' },
        { header: 'Invoice PKR', key: 'invoicePKR', width: 14, group: 'Assessable Value', align: 'right', numFmt: '#,##0' },
        { header: 'Insurance', key: 'insuranceCharges', width: 14, group: 'Assessable Value', align: 'right', numFmt: '#,##0' },
        { header: 'Landing', key: 'landingCharges', width: 14, group: 'Assessable Value', align: 'right', numFmt: '#,##0' },
        { header: 'AV (PKR)', key: 'assessableValue', width: 16, group: 'Assessable Value', align: 'right', numFmt: '#,##0' },
      ];

      // If isLocalPurchase is true, these are the total valuations columns:
      const COLUMNS_LOCAL_TOTALS = [
        { header: 'Unit Cost', key: 'unitCostPKR', width: 16, group: 'Total Valuations', align: 'right', numFmt: '#,##0' },
        { header: 'Final Total', key: 'totalCostPKR', width: 18, group: 'Total Valuations', align: 'right', numFmt: '#,##0' },
      ];

      // If isLocalPurchase is false (Import Purchase), these are the additional columns:
      const COLUMNS_IMPORT_DUTY = [
        { header: 'CD', key: 'customsDutyAmount', width: 12, group: 'Duty & Tax Calculation', align: 'right', numFmt: '#,##0' },
        { header: 'RD', key: 'regulatoryDutyAmount', width: 12, group: 'Duty & Tax Calculation', align: 'right', numFmt: '#,##0' },
        { header: 'ACD', key: 'additionalCustomsDutyAmount', width: 12, group: 'Duty & Tax Calculation', align: 'right', numFmt: '#,##0' },
        { header: 'vST', key: 'vST', width: 14, group: 'Duty & Tax Calculation', align: 'right', numFmt: '#,##0' },
        { header: 'ST', key: 'salesTaxAmount', width: 12, group: 'Duty & Tax Calculation', align: 'right', numFmt: '#,##0' },
        { header: 'AST', key: 'additionalSalesTaxAmount', width: 12, group: 'Duty & Tax Calculation', align: 'right', numFmt: '#,##0' },
        { header: 'vIT', key: 'vIT', width: 14, group: 'Duty & Tax Calculation', align: 'right', numFmt: '#,##0' },
        { header: 'IT', key: 'incomeTaxAmount', width: 12, group: 'Duty & Tax Calculation', align: 'right', numFmt: '#,##0' },
        { header: 'Excise', key: 'exciseChargesAmount', width: 12, group: 'Duty & Tax Calculation', align: 'right', numFmt: '#,##0' },
        { header: 'Total Duty', key: 'totalDuty', width: 16, group: 'Duty & Tax Calculation', align: 'right', numFmt: '#,##0' },
      ];

      const COLUMNS_IMPORT_FREIGHT = [
        { header: 'Freight (MIS)', key: 'misFreightPKR_F', width: 14, group: 'Freight', align: 'right', numFmt: '#,##0' },
      ];

      const COLUMNS_IMPORT_MIS = [
        { header: 'Frg USD', key: 'misFreightUSD', width: 12, group: 'MIS Breakdown (Shares)', align: 'right', numFmt: '#,##0' },
        { header: 'Frg PKR', key: 'misFreightPKR', width: 14, group: 'MIS Breakdown (Shares)', align: 'right', numFmt: '#,##0' },
        { header: 'Inv#', key: 'misFreightInvNo', width: 12, group: 'MIS Breakdown (Shares)', align: 'center' },
        { header: 'Date', key: 'misFreightDate', width: 12, group: 'MIS Breakdown (Shares)', align: 'center' },
        { header: 'DO/THC', key: 'misDoThcPKR', width: 14, group: 'MIS Breakdown (Shares)', align: 'right', numFmt: '#,##0' },
        { header: 'PO#', key: 'misDoThcPoNo', width: 12, group: 'MIS Breakdown (Shares)', align: 'center' },
        { header: 'Date', key: 'misDoThcDate', width: 12, group: 'MIS Breakdown (Shares)', align: 'center' },
        { header: 'Bank', key: 'misBankPKR', width: 14, group: 'MIS Breakdown (Shares)', align: 'right', numFmt: '#,##0' },
        { header: 'Ins', key: 'misInsurancePKR', width: 14, group: 'MIS Breakdown (Shares)', align: 'right', numFmt: '#,##0' },
        { header: 'Pol#', key: 'misInsurancePolicyNo', width: 12, group: 'MIS Breakdown (Shares)', align: 'center' },
        { header: 'Clg/Fwd', key: 'misClgFwdPKR', width: 14, group: 'MIS Breakdown (Shares)', align: 'right', numFmt: '#,##0' },
        { header: 'Bill#', key: 'misClgFwdBillNo', width: 12, group: 'MIS Breakdown (Shares)', align: 'center' },
      ];

      const COLUMNS_IMPORT_TOTALS = [
        { header: 'Other Charges', key: 'totalOtherCharges', width: 16, group: 'Total Valuations', align: 'right', numFmt: '#,##0' },
        { header: 'Unit Cost', key: 'unitCostPKR', width: 16, group: 'Total Valuations', align: 'right', numFmt: '#,##0' },
        { header: 'Final Total', key: 'totalCostPKR', width: 18, group: 'Total Valuations', align: 'right', numFmt: '#,##0' },
      ];

      const COLUMNS = isLocalPurchase
        ? [...COLUMNS_COMMON_DETAILS, ...COLUMNS_COMMON_AV, ...COLUMNS_LOCAL_TOTALS]
        : [...COLUMNS_COMMON_DETAILS, ...COLUMNS_COMMON_AV, ...COLUMNS_IMPORT_DUTY, ...COLUMNS_IMPORT_FREIGHT, ...COLUMNS_IMPORT_MIS, ...COLUMNS_IMPORT_TOTALS];

      // 4. Initialize Excel Workbook
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        filename: filePath,
        useStyles: true,
        useSharedStrings: false,
      });

      const ws = workbook.addWorksheet('Landed Cost Ledger', {
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
        views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }],
      });

      ws.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));

      // ── Row 1: Group headers
      const groups: Record<string, { start: number; end: number }> = {};
      COLUMNS.forEach((col, idx) => {
        const n = idx + 1;
        if (!groups[col.group]) groups[col.group] = { start: n, end: n };
        else groups[col.group].end = n;
      });

      const groupRow = ws.getRow(1);
      COLUMNS.forEach((col, idx) => {
        const cell = groupRow.getCell(idx + 1);
        const { start } = groups[col.group];
        if (idx + 1 === start) cell.value = col.group.toUpperCase();
        cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${GROUP_COLORS[col.group] ?? '1E293B'}` } };
        cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border    = {
          top:    { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
          left:   { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
          bottom: { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
          right:  { style: 'thin', color: { argb: `FF${BORDER_COLOR}` } },
        };
      });
      groupRow.height = 22;
      groupRow.commit();

      // ── Row 2: Column headers
      const headerRow = ws.getRow(2);
      COLUMNS.forEach((col, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value     = col.header;
        cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SUBHEADER_BG}` } };
        cell.font      = { bold: true, color: { argb: `FF${SUBHEADER_FG}` }, size: 9 };
        cell.alignment = { horizontal: col.align as any || 'left', vertical: 'middle' };
        cell.border    = {
          top:    { style: 'thin',   color: { argb: `FF${BORDER_COLOR}` } },
          left:   { style: 'thin',   color: { argb: `FF${BORDER_COLOR}` } },
          bottom: { style: 'medium', color: { argb: `FF${BORDER_COLOR}` } },
          right:  { style: 'thin',   color: { argb: `FF${BORDER_COLOR}` } },
        };
      });
      headerRow.height = 20;
      headerRow.commit();

      // ── Write Data rows
      let rowIdx = 0;
      const totalsAccumulator: Record<string, number> = {
        qty: 0,
        invoiceForeign: 0,
        freightForeign: 0,
        invoicePKR: 0,
        insuranceCharges: 0,
        landingCharges: 0,
        assessableValue: 0,
        customsDutyAmount: 0,
        regulatoryDutyAmount: 0,
        additionalCustomsDutyAmount: 0,
        salesTaxAmount: 0,
        additionalSalesTaxAmount: 0,
        incomeTaxAmount: 0,
        exciseChargesAmount: 0,
        totalDuty: 0,
        misFreightPKR_F: 0,
        misFreightUSD: 0,
        misFreightPKR: 0,
        misDoThcPKR: 0,
        misBankPKR: 0,
        misInsurancePKR: 0,
        misClgFwdPKR: 0,
        totalOtherCharges: 0,
        totalCostPKR: 0,
      };

      for (const item of filteredItems) {
        const isAlt = rowIdx % 2 === 1;

        // Numeric parsing (match formatInt rounding)
        const qtyVal = Math.round(Number(item.qty || 0));
        const unitFobVal = Math.round(Number(item.unitFob || 0));
        const invoiceForeignVal = Math.round(Number(item.invoiceForeign || 0));
        const freightForeignVal = Math.round(Number(item.freightForeign || 0));
        const exchangeRateVal = Number(item.exchangeRate || 1);
        const invoicePKRVal = Math.round(Number(item.invoicePKR || 0));
        const insuranceChargesVal = Math.round(Number(item.insuranceCharges || 0));
        const landingChargesVal = Math.round(Number(item.landingCharges || 0));
        const assessableValueVal = Math.round(Number(item.assessableValue || 0));

        const customsDutyAmountVal = Math.round(Number(item.customsDutyAmount || 0));
        const regulatoryDutyAmountVal = Math.round(Number(item.regulatoryDutyAmount || 0));
        const additionalCustomsDutyAmountVal = Math.round(Number(item.additionalCustomsDutyAmount || 0));
        const salesTaxAmountVal = Math.round(Number(item.salesTaxAmount || 0));
        const additionalSalesTaxAmountVal = Math.round(Number(item.additionalSalesTaxAmount || 0));
        const incomeTaxAmountVal = Math.round(Number(item.incomeTaxAmount || 0));
        const exciseChargesAmountVal = Math.round(Number(item.exciseChargesAmount || 0));

        const itemDutyVal = customsDutyAmountVal + regulatoryDutyAmountVal + additionalCustomsDutyAmountVal + salesTaxAmountVal + additionalSalesTaxAmountVal + incomeTaxAmountVal;
        const totalDutyVal = itemDutyVal + exciseChargesAmountVal;

        const misFreightPKRVal = Math.round(Number(item.misFreightPKR || 0));
        const misFreightUSDVal = Math.round(Number(item.misFreightUSD || 0));
        const misDoThcPKRVal = Math.round(Number(item.misDoThcPKR || 0));
        const misBankPKRVal = Math.round(Number(item.misBankPKR || 0));
        const misInsurancePKRVal = Math.round(Number(item.misInsurancePKR || 0));
        const misClgFwdPKRVal = Math.round(Number(item.misClgFwdPKR || 0));

        const totalOtherChargesVal = misFreightPKRVal + misDoThcPKRVal + misBankPKRVal + misInsurancePKRVal + misClgFwdPKRVal;
        const unitCostPKRVal = Math.round(Number(item.unitCostPKR || 0));
        const totalCostPKRVal = Math.round(Number(item.totalCostPKR || 0));

        // Intermediate calculated fields
        const vSTVal = assessableValueVal + customsDutyAmountVal + regulatoryDutyAmountVal + additionalCustomsDutyAmountVal;
        const vITVal = vSTVal + salesTaxAmountVal + additionalSalesTaxAmountVal;

        // Totals accumulation
        totalsAccumulator.qty += qtyVal;
        totalsAccumulator.invoiceForeign += invoiceForeignVal;
        totalsAccumulator.freightForeign += freightForeignVal;
        totalsAccumulator.invoicePKR += invoicePKRVal;
        totalsAccumulator.insuranceCharges += insuranceChargesVal;
        totalsAccumulator.landingCharges += landingChargesVal;
        totalsAccumulator.assessableValue += assessableValueVal;
        totalsAccumulator.customsDutyAmount += customsDutyAmountVal;
        totalsAccumulator.regulatoryDutyAmount += regulatoryDutyAmountVal;
        totalsAccumulator.additionalCustomsDutyAmount += additionalCustomsDutyAmountVal;
        totalsAccumulator.salesTaxAmount += salesTaxAmountVal;
        totalsAccumulator.additionalSalesTaxAmount += additionalSalesTaxAmountVal;
        totalsAccumulator.incomeTaxAmount += incomeTaxAmountVal;
        totalsAccumulator.exciseChargesAmount += exciseChargesAmountVal;
        totalsAccumulator.totalDuty += totalDutyVal;
        totalsAccumulator.misFreightPKR_F += misFreightPKRVal;
        totalsAccumulator.misFreightUSD += misFreightUSDVal;
        totalsAccumulator.misFreightPKR += misFreightPKRVal;
        totalsAccumulator.misDoThcPKR += misDoThcPKRVal;
        totalsAccumulator.misBankPKR += misBankPKRVal;
        totalsAccumulator.misInsurancePKR += misInsurancePKRVal;
        totalsAccumulator.misClgFwdPKR += misClgFwdPKRVal;
        totalsAccumulator.totalOtherCharges += totalOtherChargesVal;
        totalsAccumulator.totalCostPKR += totalCostPKRVal;

        const rowData: Record<string, any> = {
          lcNo: landedCost.lcNo || '-',
          blNo: landedCost.blNo || '-',
          blDate: landedCost.blDate ? new Date(landedCost.blDate) : null,
          gdNo: landedCost.gdNo || '-',
          countryOfOrigin: landedCost.countryOfOrigin || '-',
          season: landedCost.season || '-',
          category: landedCost.category || '-',
          shippingInvoiceNo: landedCost.shippingInvoiceNo || '-',
          shippingInvoiceDate: landedCost.shippingInvoiceDate ? new Date(landedCost.shippingInvoiceDate) : null,
          sku: item.sku || '',
          description: item.description || '',
          hsCode: item.hsCode || '-',

          qty: qtyVal,
          unitFob: unitFobVal,
          invoiceForeign: invoiceForeignVal,
          freightForeign: freightForeignVal,
          exchangeRate: exchangeRateVal,
          invoicePKR: invoicePKRVal,
          insuranceCharges: insuranceChargesVal,
          landingCharges: landingChargesVal,
          assessableValue: assessableValueVal,

          customsDutyAmount: customsDutyAmountVal,
          regulatoryDutyAmount: regulatoryDutyAmountVal,
          additionalCustomsDutyAmount: additionalCustomsDutyAmountVal,
          vST: vSTVal,
          salesTaxAmount: salesTaxAmountVal,
          additionalSalesTaxAmount: additionalSalesTaxAmountVal,
          vIT: vITVal,
          incomeTaxAmount: incomeTaxAmountVal,
          exciseChargesAmount: exciseChargesAmountVal,
          totalDuty: totalDutyVal,

          misFreightPKR_F: misFreightPKRVal,

          misFreightUSD: misFreightUSDVal,
          misFreightPKR: misFreightPKRVal,
          misFreightInvNo: item.misFreightInvNo || '-',
          misFreightDate: item.misFreightDate || '-',
          misDoThcPKR: misDoThcPKRVal,
          misDoThcPoNo: item.misDoThcPoNo || '-',
          misDoThcDate: item.misDoThcDate || '-',
          misBankPKR: misBankPKRVal,
          misInsurancePKR: misInsurancePKRVal,
          misInsurancePolicyNo: item.misInsurancePolicyNo || '-',
          misClgFwdPKR: misClgFwdPKRVal,
          misClgFwdBillNo: item.misClgFwdBillNo || '-',

          totalOtherCharges: totalOtherChargesVal,
          unitCostPKR: unitCostPKRVal,
          totalCostPKR: totalCostPKRVal,
        };

        const dataRow = ws.getRow(rowIdx + 3);
        COLUMNS.forEach((col, colIdx) => {
          const cell = dataRow.getCell(colIdx + 1);
          cell.value     = rowData[col.key] ?? null;
          if (col.numFmt) cell.numFmt = col.numFmt;
          cell.alignment = { horizontal: col.align as any || 'left', vertical: 'middle' };
          cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${isAlt ? ALT_ROW_BG : 'FFFFFF'}` } };

          if (['unitCostPKR', 'totalCostPKR', 'assessableValue', 'totalDuty'].includes(col.key)) {
            cell.font = { bold: true, size: 9, color: { argb: `FF${CURRENCY_FG}` } };
          } else {
            cell.font = { size: 9 };
          }

          cell.border = {
            top:    { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
            left:   { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
            bottom: { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
            right:  { style: 'hair', color: { argb: `FF${BORDER_COLOR}` } },
          };
        });
        dataRow.height = 16;
        dataRow.commit();
        rowIdx++;

        // Report progress to Bull
        if (rowIdx % 100 === 0) {
          const pct = Math.round((rowIdx / total) * 90);
          await job.progress(pct);
          await new Promise((r) => setImmediate(r));
        }
      }

      // ── Write Totals Row
      const totalsRowIdx = rowIdx + 3;
      const totalsRow = ws.getRow(totalsRowIdx);
      totalsRow.height = 20;

      // Make first column merged or simply write "Filtered Ledger Totals"
      COLUMNS.forEach((col, colIdx) => {
        const cell = totalsRow.getCell(colIdx + 1);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${TOTALS_BG}` } };
        cell.border = {
          top:    { style: 'medium', color: { argb: `FF${BORDER_COLOR}` } },
          left:   { style: 'thin',   color: { argb: `FF${BORDER_COLOR}` } },
          bottom: { style: 'double', color: { argb: `FF${BORDER_COLOR}` } },
          right:  { style: 'thin',   color: { argb: `FF${BORDER_COLOR}` } },
        };

        if (colIdx === 0) {
          cell.value = `LEDGER TOTALS (${rowIdx} items)`;
          cell.font = { bold: true, size: 9 };
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        } else if (col.key in totalsAccumulator) {
          cell.value = totalsAccumulator[col.key];
          cell.font = { bold: true, size: 9 };
          if (col.numFmt) cell.numFmt = col.numFmt;
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        } else if (col.key === 'vST') {
          cell.value = totalsAccumulator.assessableValue + totalsAccumulator.customsDutyAmount + totalsAccumulator.regulatoryDutyAmount + totalsAccumulator.additionalCustomsDutyAmount;
          cell.font = { bold: true, size: 9 };
          if (col.numFmt) cell.numFmt = col.numFmt;
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        } else if (col.key === 'vIT') {
          cell.value = totalsAccumulator.assessableValue + totalsAccumulator.customsDutyAmount + totalsAccumulator.regulatoryDutyAmount + totalsAccumulator.additionalCustomsDutyAmount + totalsAccumulator.salesTaxAmount + totalsAccumulator.additionalSalesTaxAmount;
          cell.font = { bold: true, size: 9 };
          if (col.numFmt) cell.numFmt = col.numFmt;
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        } else {
          cell.value = '';
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      });
      totalsRow.commit();

      // ── Write Summary sheet
      const summary = workbook.addWorksheet('Summary');
      summary.columns = [{ key: 'label', width: 30 }, { key: 'value', width: 25 }];

      const titleRow = summary.getRow(1);
      titleRow.getCell(1).value = 'Landed Cost Valuation Summary';
      titleRow.getCell(1).font  = { bold: true, size: 14, color: { argb: 'FF1E293B' } };
      titleRow.getCell(1).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      titleRow.height = 28;
      titleRow.commit();

      const summaryRows = [
        ['Landed Cost Number',   landedCost.landedCostNumber],
        ['Status',              landedCost.status],
        ['Order Type',          isLocalPurchase ? 'LOCAL' : 'IMPORT'],
        ['Supplier/Vendor',      landedCost.supplier?.name || '-'],
        ['GRN Number',           landedCost.grn?.grnNumber || '-'],
        ['LC Number',            landedCost.lcNo || '-'],
        ['B/L Number',           landedCost.blNo || '-'],
        ['GD Number',            landedCost.gdNo || '-'],
        ['Exchange Rate',        Number(landedCost.exchangeRate).toFixed(2)],
        ['Export Date',          new Date().toLocaleString('en-PK')],
        ['Total Items',          rowIdx],
        ['Total Cost (PKR)',     totalsAccumulator.totalCostPKR],
        ['Total Quantity',       totalsAccumulator.qty],
      ];

      summaryRows.forEach(([label, value], idx) => {
        const r = summary.getRow(idx + 2);
        r.getCell(1).value = label;
        r.getCell(1).font  = { bold: true, size: 10 };
        r.getCell(1).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF' } };
        
        r.getCell(2).value = value;
        r.getCell(2).font  = { size: 10 };
        if (label === 'Total Cost (PKR)' || label === 'Total Quantity') {
          r.getCell(2).numFmt = '#,##0';
        }
        r.getCell(2).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF' } };
        
        r.height = 18;
        r.commit();
      });

      await workbook.commit();
      await job.progress(100);

      this.logger.log(`[LandedCostExport ${jobId}] File written successfully: ${filePath}`);

      // ── Notify user via in-app notification
      await this.notificationsService.create({
        userId,
        title: 'Landed Cost Export Ready',
        message: `Your detailed ledger export of Landed Cost ${landedCost.landedCostNumber} (${rowIdx} items) is ready to download.`,
        category: 'export',
        priority: 'high',
        actionType: 'landed-cost-export.ready',
        actionPayload: { jobId },
        entityType: 'landed-cost-export',
        entityId: jobId,
        channels: ['inApp'],
      });

    } catch (error: any) {
      this.logger.error(`[LandedCostExport ${jobId}] FAILED: ${error.message}`, error.stack);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      await this.notificationsService.create({
        userId,
        title: 'Landed Cost Export Failed',
        message: `Export could not be completed: ${error.message}`,
        category: 'export',
        priority: 'urgent',
        channels: ['inApp'],
      });
    } finally {
      await prisma.$disconnect();
    }
  }
}
