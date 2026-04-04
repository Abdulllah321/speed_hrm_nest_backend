import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as Papa from 'papaparse';

export interface PoParsedRecord {
    row: number;
    data: {
        vendorCode?: string;
        itemId?: string;      // unique itemId field from Item model
        description?: string;
        quantity?: number;
        unitPrice?: number;
        orderType?: string;   // LOCAL | IMPORT (required, must be same for all rows)
        goodsType?: string;   // CONSUMABLE | FRESH (required, must be same for all rows)
        expectedDeliveryDate?: string;
        notes?: string;
    };
}

@Injectable()
export class PoCsvParserService {
    private readonly logger = new Logger(PoCsvParserService.name);

    private normalizeValue(value: any): string | null {
        if (value === null || value === undefined) return null;
        const str = String(value).trim();
        if (['n/a', 'n / a', 'null', 'none', '-', '', '–', '—'].includes(str.toLowerCase())) return null;
        return str;
    }

    private isEmptyRow(row: any): boolean {
        const vc = this.getValue(row, ['Vendor Code', 'VendorCode', 'vendor_code', 'vendorCode']);
        const itemId = this.getValue(row, ['Item ID', 'ItemID', 'item_id', 'itemId', 'Item Code', 'ItemCode']);
        return !this.normalizeValue(vc) && !this.normalizeValue(itemId);
    }

    private getValue(row: any, keys: string[]): any {
        for (const key of keys) {
            if (row[key] !== undefined) return row[key];
            const lk = key.toLowerCase().replace(/[\s_]/g, '');
            const found = Object.keys(row).find(k => k.toLowerCase().replace(/[\s_]/g, '') === lk);
            if (found) return row[found];
        }
        return null;
    }

    private parseNumber(value: any): number | null {
        const n = this.normalizeValue(value);
        if (n === null) return null;
        const num = parseFloat(n.replace(/,/g, ''));
        return isNaN(num) ? null : num;
    }

    private mapColumns(row: any): PoParsedRecord['data'] {
        return {
            vendorCode: this.normalizeValue(this.getValue(row, ['Vendor Code', 'VendorCode', 'vendor_code', 'vendorCode', 'Vendor'])) ?? undefined,
            itemId: this.normalizeValue(this.getValue(row, ['Item ID', 'ItemID', 'item_id', 'itemId', 'Item Code', 'ItemCode'])) ?? undefined,
            description: this.normalizeValue(this.getValue(row, ['Description', 'description', 'Item Description'])) ?? undefined,
            quantity: this.parseNumber(this.getValue(row, ['Quantity', 'Qty', 'quantity', 'qty'])) ?? undefined,
            unitPrice: this.parseNumber(this.getValue(row, ['Unit Price', 'UnitPrice', 'unit_price', 'Price', 'price'])) ?? undefined,
            orderType: this.normalizeValue(this.getValue(row, ['Order Type', 'OrderType', 'order_type', 'orderType']))?.toUpperCase() ?? undefined,
            goodsType: this.normalizeValue(this.getValue(row, ['Goods Type', 'GoodsType', 'goods_type', 'goodsType']))?.toUpperCase() ?? undefined,
            expectedDeliveryDate: this.normalizeValue(this.getValue(row, ['Expected Delivery Date', 'DeliveryDate', 'delivery_date', 'Expected Date'])) ?? undefined,
            notes: this.normalizeValue(this.getValue(row, ['Notes', 'notes', 'Remarks', 'remarks'])) ?? undefined,
        };
    }

    async parseCSVStreaming(fileBuffer: Buffer, onRecord: (record: PoParsedRecord) => Promise<void>): Promise<void> {
        return new Promise((resolve, reject) => {
            let rowCount = 0;
            Papa.parse(fileBuffer.toString('utf-8'), {
                header: true,
                skipEmptyLines: 'greedy',
                chunkSize: 1024 * 1024 * 2,
                chunk: async (results, parser) => {
                    parser.pause();
                    for (const row of results.data) {
                        if (!this.isEmptyRow(row)) {
                            await onRecord({ row: ++rowCount + 1, data: this.mapColumns(row) });
                        }
                    }
                    parser.resume();
                },
                complete: () => resolve(),
                error: (err) => reject(new Error(`CSV parse error: ${err.message}`)),
            });
        });
    }

    async parseExcelStreaming(fileBuffer: Buffer, onRecord: (record: PoParsedRecord) => Promise<void>): Promise<void> {
        const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
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
                    // Format dates
                    rowObj[headers[C]] = cell.t === 'd' ? (cell.v as Date).toISOString().split('T')[0] : cell.v;
                    hasData = true;
                }
            }
            if (hasData && !this.isEmptyRow(rowObj)) {
                await onRecord({ row: R + 1, data: this.mapColumns(rowObj) });
                rowCount++;
            }
        }
        this.logger.log(`Processed ${rowCount} PO records from Excel`);
    }

    async parseFileStreaming(fileBuffer: Buffer, filename: string, onRecord: (record: PoParsedRecord) => Promise<void>): Promise<void> {
        const ext = filename.toLowerCase().split('.').pop();
        if (ext === 'csv') return this.parseCSVStreaming(fileBuffer, onRecord);
        if (['xlsx', 'xls'].includes(ext as string)) return this.parseExcelStreaming(fileBuffer, onRecord);
        throw new Error(`Unsupported file format: ${ext}`);
    }
}
