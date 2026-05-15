import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as Papa from 'papaparse';

export interface SalesHistoryParsedRecord {
    row: number;
    data: {
        // Document / order identity
        documentNumber?: string;   // Sale1, Sale2 … (groups multi-item orders)
        subType?: string;          // "Sale"
        documentDate?: string;     // 7/1/2025

        // Item identity — only barCode is required for lookup
        barCode?: string;          // 4.06789E+12 or plain string
        sku?: string;              // SKU column if present

        // Line financials
        quantity?: number;
        unitPrice?: number;
        discountAmount?: number;
        discountPercent?: number;
        salesTax?: number;
        additionalSalesTax?: number;
        totalPriceWithTax?: number;  // Value Incl Sales Tax
        totalPriceWithoutTax?: number; // Total_Price_W_O_T

        // Payment / tender
        cashSale?: number;
        cashReturn?: number;
        cardSale?: number;
        giftVoucherAmount?: number;
        creditVoucherAmount?: number;
        exchangeVoucherAmount?: number;
        claimVoucherAmount?: number;
        onCreditAmount?: number;

        // FBR
        fbrInvoiceNumber?: string;

        // Location / POS
        posId?: string;
        costCentre?: string;

        // Misc
        remarks?: string;
        isAllianceDiscount?: boolean;
        salesPersonId?: string;
        cashierName?: string;
        salesPerson?: string;
    };
}

@Injectable()
export class SalesHistoryCsvParserService {
    private readonly logger = new Logger(SalesHistoryCsvParserService.name);

    // ── Helpers ──────────────────────────────────────────────────────────

    private normalizeValue(value: any): string | null {
        if (value === null || value === undefined) return null;
        const s = String(value).trim();
        const naPatterns = ['n/a', 'n / a', 'null', 'none', '-', '', '–', '—'];
        if (naPatterns.includes(s.toLowerCase())) return null;
        return s;
    }

    private parseNumber(value: any): number | null {
        const norm = this.normalizeValue(value);
        if (norm === null) return null;
        // Strip commas (e.g. "18,720") and percent signs
        const clean = norm.replace(/,/g, '').replace(/%/g, '').trim();
        const n = parseFloat(clean);
        return isNaN(n) ? null : n;
    }

    /**
     * Parse a barcode that may be in scientific notation (e.g. 4.06789E+12)
     * Excel stores long numeric barcodes as floats — we need the full integer string.
     */
    private parseBarCode(value: any): string | null {
        if (value === null || value === undefined) return null;

        // If it's already a string with no scientific notation, return as-is
        if (typeof value === 'string') {
            const s = value.trim();
            if (!s || s === '-' || s.toLowerCase() === 'n/a') return null;
            // Handle scientific notation in string form
            if (/e[+\-]/i.test(s)) {
                const n = parseFloat(s);
                if (!isNaN(n)) return Math.round(n).toString();
            }
            return s;
        }

        // Numeric value from Excel — convert to integer string
        if (typeof value === 'number') {
            return Math.round(value).toString();
        }

        return null;
    }

    private getValue(row: any, keys: string[]): any {
        if (!row) return null;
        for (const key of keys) {
            if (row[key] !== undefined) return row[key];
            const lk = key.toLowerCase().replace(/[\s_]/g, '');
            const found = Object.keys(row).find(k => k.toLowerCase().replace(/[\s_]/g, '') === lk);
            if (found !== undefined && row[found] !== undefined) return row[found];
        }
        return null;
    }

    private isEmptyRow(row: any): boolean {
        if (!row) return true;
        const docNum = this.normalizeValue(this.getValue(row, ['DocumentNumber', 'Document Number', 'SUB']));
        const barCode = this.parseBarCode(this.getValue(row, ['BarCode', 'Bar Code', 'Barcode']));
        return !docNum && !barCode;
    }

    // ── Column mapping ────────────────────────────────────────────────────

    private mapColumns(row: any): SalesHistoryParsedRecord['data'] {
        return {
            documentNumber: this.normalizeValue(this.getValue(row, [
                'DocumentNumber', 'Document Number', 'DocumentNo', 'Doc Number', 'SUB',
            ])) ?? undefined,

            subType: this.normalizeValue(this.getValue(row, [
                'SUB Type', 'SubType', 'Sub Type', 'Type',
            ])) ?? undefined,

            documentDate: this.normalizeValue(this.getValue(row, [
                'DocumentDate', 'Document Date', 'Date', 'FromDate',
            ])) ?? undefined,

            barCode: this.parseBarCode(this.getValue(row, [
                'BarCode', 'Bar Code', 'Barcode', 'BARCODE',
            ])) ?? undefined,

            sku: this.normalizeValue(this.getValue(row, [
                'SKU', 'Sku', 'sku',
            ])) ?? undefined,

            quantity: this.parseNumber(this.getValue(row, [
                'Quantity', 'QTY', 'Qty', 'quantity',
            ])) ?? undefined,

            unitPrice: this.parseNumber(this.getValue(row, [
                'UnitPrice', 'Unit Price', 'unitprice',
            ])) ?? undefined,

            discountAmount: this.parseNumber(this.getValue(row, [
                'DiscountAmount', 'Discount Amount', 'DiscountAmount',
            ])) ?? undefined,

            discountPercent: this.parseNumber(this.getValue(row, [
                'DiscountRate_Given', 'Discount Rate Given', 'DiscountRate', 'Discount %',
            ])) ?? undefined,

            salesTax: this.parseNumber(this.getValue(row, [
                'Sales Tax', 'SalesTax', 'ST',
            ])) ?? undefined,

            additionalSalesTax: this.parseNumber(this.getValue(row, [
                'Additional Sales Tax', 'AdditionalSalesTax', 'AST',
            ])) ?? undefined,

            totalPriceWithTax: this.parseNumber(this.getValue(row, [
                'Value Incl Sales Tax', 'ValueInclSalesTax', 'Total_Price_W_T',
            ])) ?? undefined,

            totalPriceWithoutTax: this.parseNumber(this.getValue(row, [
                'Total_Price_W_O_T', 'TotalPriceWOT', 'Price_W_O_T',
            ])) ?? undefined,

            cashSale: this.parseNumber(this.getValue(row, [
                'CashSale', 'Cash Sale', 'Cash',
            ])) ?? undefined,

            cashReturn: this.parseNumber(this.getValue(row, [
                'CashRetrun', 'CashReturn', 'Cash Return',
            ])) ?? undefined,

            cardSale: this.parseNumber(this.getValue(row, [
                'CardSale', 'Card Sale', 'Card',
            ])) ?? undefined,

            giftVoucherAmount: this.parseNumber(this.getValue(row, [
                'GiftVoucherAmount', 'Gift Voucher Amount',
            ])) ?? undefined,

            creditVoucherAmount: this.parseNumber(this.getValue(row, [
                'CreditVoucherAmount', 'Credit Voucher Amount',
            ])) ?? undefined,

            exchangeVoucherAmount: this.parseNumber(this.getValue(row, [
                'ExchangeVoucherAmount', 'Exchange Voucher Amount',
            ])) ?? undefined,

            claimVoucherAmount: this.parseNumber(this.getValue(row, [
                'ClaimVoucherAmount', 'Claim Voucher Amount',
            ])) ?? undefined,

            onCreditAmount: this.parseNumber(this.getValue(row, [
                'OnCreditAmount', 'On Credit Amount', 'Balance',
            ])) ?? undefined,

            fbrInvoiceNumber: this.normalizeValue(this.getValue(row, [
                'FBR Invoice#', 'FBRInvoice', 'FBR Invoice Number', 'FKExchangeVoucherNumber',
            ])) ?? undefined,

            posId: this.normalizeValue(this.getValue(row, [
                'POS ID', 'POSID', 'PosId',
            ])) ?? undefined,

            costCentre: this.normalizeValue(this.getValue(row, [
                'CostCentre', 'Cost Centre', 'CostCenter',
            ])) ?? undefined,

            remarks: this.normalizeValue(this.getValue(row, [
                'Remarks', 'Notes', 'remarks',
            ])) ?? undefined,

            isAllianceDiscount: (() => {
                const v = this.normalizeValue(this.getValue(row, ['Is Alliance Discount', 'IsAllianceDiscount']));
                return v === 'Y' || v === 'y' || v === '1' || v === 'true';
            })(),

            salesPersonId: this.normalizeValue(this.getValue(row, [
                'FKSalesPersonID', 'SalesPersonID', 'Sales Person ID',
            ])) ?? undefined,

            cashierName: this.normalizeValue(this.getValue(row, [
                'CashierName', 'Cashier Name',
            ])) ?? undefined,

            salesPerson: this.normalizeValue(this.getValue(row, [
                'SalesPerson', 'Sales Person',
            ])) ?? undefined,
        };
    }

    // ── CSV streaming ─────────────────────────────────────────────────────

    async parseCSVStreaming(
        fileBuffer: Buffer,
        onRecord: (record: SalesHistoryParsedRecord) => Promise<void>,
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const csvString = fileBuffer.toString('utf-8');
            let rowCount = 0;

            Papa.parse(csvString, {
                header: true,
                skipEmptyLines: 'greedy',
                chunkSize: 1024 * 1024 * 2,
                chunk: async (results, parser) => {
                    parser.pause();
                    for (const row of results.data) {
                        if (!this.isEmptyRow(row)) {
                            rowCount++;
                            await onRecord({
                                row: rowCount + 1,
                                data: this.mapColumns(row),
                            });
                        }
                    }
                    parser.resume();
                },
                complete: () => {
                    this.logger.log(`Streamed ${rowCount} sales history records from CSV`);
                    resolve();
                },
                error: (error) => {
                    this.logger.error(`CSV streaming error: ${error.message}`);
                    reject(new Error(`Failed to stream CSV: ${error.message}`));
                },
            });
        });
    }

    // ── Excel streaming ───────────────────────────────────────────────────

    async parseExcelStreaming(
        fileBuffer: Buffer,
        onRecord: (record: SalesHistoryParsedRecord) => Promise<void>,
    ): Promise<void> {
        try {
            const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            if (!worksheet) return;

            const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
            const headers: string[] = [];
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cell = worksheet[XLSX.utils.encode_cell({ r: range.s.r, c: C })];
                headers.push(cell ? String(cell.v) : `COL_${C}`);
            }

            let rowCount = 0;
            for (let R = range.s.r + 1; R <= range.e.r; ++R) {
                const rowObj: any = {};
                let hasData = false;
                for (let C = range.s.c; C <= range.e.c; ++C) {
                    const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: C })];
                    if (cell && cell.v !== null && cell.v !== undefined) {
                        // Prefer formatted text (cell.w) to preserve trailing zeros in barcodes
                        rowObj[headers[C]] = cell.w !== undefined ? cell.w : cell.v;
                        hasData = true;
                    }
                }
                if (hasData && !this.isEmptyRow(rowObj)) {
                    await onRecord({
                        row: R + 1,
                        data: this.mapColumns(rowObj),
                    });
                    rowCount++;
                }
            }
            this.logger.log(`Processed ${rowCount} sales history records from Excel`);
        } catch (error) {
            this.logger.error(`Excel processing error: ${error.message}`);
            throw new Error(`Failed to process Excel: ${error.message}`);
        }
    }

    // ── Auto-detect ───────────────────────────────────────────────────────

    async parseFileStreaming(
        fileBuffer: Buffer,
        filename: string,
        onRecord: (record: SalesHistoryParsedRecord) => Promise<void>,
    ): Promise<void> {
        const ext = filename.toLowerCase().split('.').pop();
        if (ext === 'csv') return this.parseCSVStreaming(fileBuffer, onRecord);
        if (['xlsx', 'xls'].includes(ext as string)) return this.parseExcelStreaming(fileBuffer, onRecord);
        throw new Error(`Unsupported file format: ${ext}`);
    }
}
