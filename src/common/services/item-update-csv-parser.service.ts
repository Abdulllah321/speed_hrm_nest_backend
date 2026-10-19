import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as Papa from 'papaparse';

export interface ItemUpdateParsedRecord {
  row: number;
  data: {
    barCode?: string;
    sku?: string;
    salePrice?: number | null;
    fob?: number | null;
    taxRate1?: number | null;
    taxRate2?: number | null;
    discountRate?: number | null;
    season?: string | null;
  };
}

@Injectable()
export class ItemUpdateCsvParserService {
  private readonly logger = new Logger(ItemUpdateCsvParserService.name);

  private normalizeValue(value: any): string | null {
    if (value === null || value === undefined) return null;

    let str = String(value).trim();
    if (!str) return null;

    // Handle scientific notation e.g., 8.90123E+12
    if (/^[0-9]+(\.[0-9]+)?[eE][+-]?[0-9]+$/.test(str)) {
      const num = Number(str);
      if (!isNaN(num)) {
        str = num.toLocaleString('fullwide', { useGrouping: false });
      }
    }

    // Strip trailing .0 from numeric identifiers
    if (/^\d+\.0$/.test(str)) {
      str = str.replace(/\.0$/, '');
    }

    const naPatterns = ['n/a', 'n / a', 'null', 'none', '-', '', '–', '—'];
    if (naPatterns.includes(str.toLowerCase())) return null;

    return str;
  }

  /**
   * Parse number from string or Excel value.
   * - Empty / N/A / dash returns undefined (meaning: do not update, leave existing)
   * - Valid numbers return number
   * - Invalid string returns null (so validator catches and reports syntax errors)
   */
  private parseNumber(
    value: any,
    isPercentage = false,
  ): number | null | undefined {
    if (value === null || value === undefined) return undefined;

    const normalized = this.normalizeValue(value);
    if (normalized === null) return undefined;

    // Handle Excel percentage numbers (e.g. 0.05 => 5)
    if (typeof value === 'number') {
      if (isPercentage && value > 0 && value < 1) {
        return Math.round(value * 10000) / 100;
      }
      return value;
    }

    let cleanStr = normalized.replace(/,/g, '').trim();
    if (isPercentage && cleanStr.endsWith('%')) {
      cleanStr = cleanStr.replace('%', '').trim();
    }

    // Clean non-numeric characters except '-' and '.'
    cleanStr = cleanStr.replace(/[^0-9.\-]/g, '');
    if (!cleanStr || cleanStr === '-') return undefined;

    const num = parseFloat(cleanStr);
    return isNaN(num) ? null : num;
  }

  private isEmptyRow(row: Record<string, any>): boolean {
    if (!row || typeof row !== 'object') return true;
    const values = Object.values(row);
    if (values.length === 0) return true;
    return values.every((v) => this.normalizeValue(v) === null);
  }

  /**
   * Builds an O(1) case-and-punctuation-insensitive lookup map for row keys
   */
  private buildNormalizedRowMap(row: Record<string, any>): Map<string, any> {
    const map = new Map<string, any>();
    for (const [key, val] of Object.entries(row)) {
      if (key !== undefined) {
        map.set(key.toLowerCase().replace(/[\s_\-\.]/g, ''), val);
      }
    }
    return map;
  }

  private getValueFromMap(map: Map<string, any>, keys: string[]): any {
    for (const key of keys) {
      const cleanKey = key.toLowerCase().replace(/[\s_\-\.]/g, '');
      if (map.has(cleanKey)) return map.get(cleanKey);
    }
    return null;
  }

  private mapColumns(row: Record<string, any>): ItemUpdateParsedRecord['data'] {
    const rowMap = this.buildNormalizedRowMap(row);

    const rawBarcode = this.getValueFromMap(rowMap, [
      'Barcode',
      'Bar Code',
      'barCode',
      'Bar_Code',
      'Code',
    ]);
    const rawSku = this.getValueFromMap(rowMap, [
      'SKU',
      'sku',
      'ItemCode',
      'Item Code',
      'Item_Code',
    ]);
    const rawSalePrice = this.getValueFromMap(rowMap, [
      'Sale Price',
      'SalePrice',
      'UnitPrice',
      'Unit Price',
      'Price',
      'Sale_Price',
      'Retail Price',
      'RetailPrice',
    ]);
    const rawFob = this.getValueFromMap(rowMap, [
      'FOB',
      'fob',
      'FobPrice',
      'Fob Price',
      'Fob_Price',
    ]);
    const rawTaxRate1 = this.getValueFromMap(rowMap, [
      'Sales Tax Rate',
      'SalesTaxRate',
      'Tax Rate 1',
      'TaxRate1',
      'taxrate1',
      'taxRate1',
      'Sales_Tax_Rate',
      'Tax Rate',
    ]);
    const rawTaxRate2 = this.getValueFromMap(rowMap, [
      'Additional Sales Tax',
      'AdditionalSalesTax',
      'Tax Rate 2',
      'TaxRate2',
      'taxrate2',
      'taxRate2',
      'Additional_Sales_Tax',
      'Additional Tax',
    ]);
    const rawDiscountRate = this.getValueFromMap(rowMap, [
      'Discount %',
      'Discount%',
      'Discount Rate',
      'DiscountRate',
      'Discount',
      'discount',
      'Discount Percentage',
      'DiscountPercentage',
      'Discount_Percentage',
      'Discount_Rate',
    ]);
    const rawSeason = this.getValueFromMap(rowMap, [
      'Season',
      'season',
      'Season Name',
      'SeasonName',
      'Season_Name',
      'New Season',
      'NewSeason',
      'New_Season',
    ]);

    return {
      barCode: this.normalizeValue(rawBarcode) ?? undefined,
      sku: this.normalizeValue(rawSku) ?? undefined,
      salePrice: this.parseNumber(rawSalePrice, false),
      fob: this.parseNumber(rawFob, false),
      taxRate1: this.parseNumber(rawTaxRate1, true),
      taxRate2: this.parseNumber(rawTaxRate2, true),
      discountRate: this.parseNumber(rawDiscountRate, true),
      season: this.normalizeValue(rawSeason) ?? undefined,
    };
  }

  async parseCSVStreaming(
    fileBuffer: Buffer,
    onRecord: (record: ItemUpdateParsedRecord) => Promise<void>,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const csvString = fileBuffer.toString('utf-8');
      let physicalRow = 1; // Row 1 is header
      let streamedCount = 0;

      Papa.parse(csvString, {
        header: true,
        skipEmptyLines: 'greedy',
        chunkSize: 1024 * 1024 * 2,
        chunk: async (results, parser) => {
          parser.pause();
          for (const row of results.data as Record<string, any>[]) {
            physicalRow++;
            if (!this.isEmptyRow(row)) {
              await onRecord({
                row: physicalRow,
                data: this.mapColumns(row),
              });
              streamedCount++;
            }
          }
          parser.resume();
        },
        complete: () => {
          this.logger.log(
            `Streamed ${streamedCount} Item Update records from CSV (${physicalRow - 1} rows scanned)`,
          );
          resolve();
        },
        error: (error) => {
          this.logger.error(`CSV streaming error: ${error.message}`);
          reject(new Error(`Failed to stream CSV: ${error.message}`));
        },
      });
    });
  }

  async parseExcelStreaming(
    fileBuffer: Buffer,
    onRecord: (record: ItemUpdateParsedRecord) => Promise<void>,
  ): Promise<void> {
    try {
      const workbook = XLSX.read(fileBuffer, {
        type: 'buffer',
        cellDates: true,
      });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) return;

      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

      // 1. Detect Header Row
      let headerRowIdx = range.s.r;
      for (let R = range.s.r; R <= range.e.r; ++R) {
        let nonBlankCount = 0;
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: C })];
          if (
            cell &&
            cell.v !== null &&
            cell.v !== undefined &&
            String(cell.v).trim() !== ''
          ) {
            nonBlankCount++;
          }
        }
        if (nonBlankCount >= 2) {
          headerRowIdx = R;
          break;
        }
      }

      // 2. Read headers mapped by column index C (prevents column shift if range.s.c > 0)
      const headersByCol: Record<number, string> = {};
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cell =
          worksheet[XLSX.utils.encode_cell({ r: headerRowIdx, c: C })];
        const val =
          cell && cell.w
            ? cell.w.trim()
            : cell?.v !== null && cell?.v !== undefined
              ? String(cell.v).trim()
              : '';
        headersByCol[C] = val || `COL_${C}`;
      }

      // 3. Stream data rows
      let rowCount = 0;
      for (let R = headerRowIdx + 1; R <= range.e.r; ++R) {
        const rowObj: Record<string, any> = {};
        let hasData = false;
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: C })];
          if (cell && cell.v !== null && cell.v !== undefined) {
            // Prefer formatted text 'w' for string fields/barcodes to prevent scientific notation
            rowObj[headersByCol[C]] =
              cell.t === 's' || (cell.w && !cell.t) ? cell.w : cell.v;
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
      this.logger.log(`Processed ${rowCount} Item Update records from Excel`);
    } catch (error) {
      this.logger.error(`Excel processing error: ${error.message}`);
      throw new Error(`Failed to process Excel: ${error.message}`);
    }
  }

  async parseFileStreaming(
    fileBuffer: Buffer,
    filename: string,
    onRecord: (record: ItemUpdateParsedRecord) => Promise<void>,
  ): Promise<void> {
    const ext = filename.toLowerCase().split('.').pop();
    if (ext === 'csv') {
      return this.parseCSVStreaming(fileBuffer, onRecord);
    } else if (['xlsx', 'xls'].includes(ext as string)) {
      return this.parseExcelStreaming(fileBuffer, onRecord);
    } else {
      throw new Error(`Unsupported file format: ${ext}`);
    }
  }
}
