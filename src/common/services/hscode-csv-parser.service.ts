import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as Papa from 'papaparse';

export interface HsCodeParsedRecord {
    row: number;
    data: {
        productCategory?: string;
        hsCode?: string;
        customsDutyCd?: number;
        regulatoryDutyRd?: number;
        additionalCustomsDutyAcd?: number;
        salesTax?: number;
        incomeTax?: number;
    };
}

@Injectable()
export class HsCodeCsvParserService {
    private readonly logger = new Logger(HsCodeCsvParserService.name);

    /**
     * Normalize N/A values to null
     */
    private normalizeValue(value: any): any {
        if (value === null || value === undefined) return null;

        const strValue = String(value).trim();

        // Check for various N/A patterns including dash
        const naPatterns = ['n/a', 'n / a', 'null', 'none', '-', '', '–', '—'];
        if (naPatterns.includes(strValue.toLowerCase()) || strValue === '') {
            return null;
        }

        return strValue;
    }

    /**
     * Check if a row is empty (all key fields are null/empty)
     */
    private isEmptyRow(row: any): boolean {
        if (!row) return true;

        const findValue = (key: string) => {
            const actualKey = Object.keys(row).find(k => k.toLowerCase().replace(/\s/g, '') === key.toLowerCase().replace(/\s/g, ''));
            return actualKey ? row[actualKey] : null;
        };

        // Only check HS Code field since that's the main identifier
        const hsCodeValue = this.normalizeValue(findValue('hscodes')) || 
                           this.normalizeValue(findValue('hs codes')) ||
                           this.normalizeValue(findValue('hscode')) ||
                           this.normalizeValue(findValue('hs code'));
        
        return hsCodeValue === null || hsCodeValue === '';
    }

    /**
     * Parse number from string, handling percentages
     */
    private parseNumber(value: any): number | null {
        const normalized = this.normalizeValue(value);
        if (normalized === null) return null;

        // Handle numeric values (Excel percentages come as decimals like 0.2 for 20%)
        if (typeof value === 'number') {
            // If it's a small decimal (< 1), it's likely a percentage from Excel
            if (value > 0 && value < 1) {
                return value * 100; // Convert 0.2 to 20
            }
            // If it's already a whole number, return as-is
            return value;
        }

        let cleanValue = normalized.toString().trim();
        
        // Remove % sign if present (but keep the original number value)
        cleanValue = cleanValue.replace('%', '').trim();
        
        const num = parseFloat(cleanValue);
        if (isNaN(num)) return null;
        
        // Return the number as-is (20% becomes 20, not 0.20)
        return num;
    }

    /**
     * Helper to find a value in a row object using case-insensitive key matching
     */
    private getValue(row: any, keys: string[]): any {
        if (!row) return null;
        
        for (const key of keys) {
            // Try exact match first
            if (row[key] !== undefined) return row[key];
            
            // Case-insensitive match
            const lowerKey = key.toLowerCase().replace(/\s/g, '');
            const actualKey = Object.keys(row).find(k =>
                k.toLowerCase().replace(/\s/g, '') === lowerKey
            );
            
            if (actualKey && row[actualKey] !== undefined) {
                return row[actualKey];
            }
        }
        
        return null;
    }

    /**
     * Map Excel column names to schema field names
     */
    private mapColumns(row: any): HsCodeParsedRecord['data'] {
        return {
            productCategory: undefined, // Not used in the new format
            hsCode: this.normalizeValue(this.getValue(row, [
                'HS CODES', 'HS Code', 'HsCode', 'hsCode', 'HS_CODE', 'HS_CODES', 'HSCODES'
            ])),
            customsDutyCd: this.parseNumber(this.getValue(row, [
                'CD', 'cd', 'Customs Duty CD', 'customsDutyCd', 'CD%', 'CD (%)', 'CD(%)'
            ])) as number,
            regulatoryDutyRd: this.parseNumber(this.getValue(row, [
                'RD', 'rd', 'Regulatory Duty RD', 'regulatoryDutyRd', 'RD%', 'RD (%)', 'RD(%)'
            ])) as number,
            additionalCustomsDutyAcd: this.parseNumber(this.getValue(row, [
                'ACD', 'acd', 'Additional Customs Duty ACD', 'additionalCustomsDutyAcd', 'ACD%', 'ACD (%)', 'ACD(%)'
            ])) as number,
            salesTax: this.parseNumber(this.getValue(row, [
                'ST', 'st', 'Sales Tax', 'salesTax', 'ST%', 'ST (%)', 'ST(%)'
            ])) as number,
            incomeTax: this.parseNumber(this.getValue(row, [
                'IT', 'it', 'Income Tax', 'incomeTax', 'IT%', 'IT (%)', 'IT(%)'
            ])) as number,
        };
    }    /**
     * Parse CSV file with streaming support
     */
    async parseCSVStreaming(fileBuffer: Buffer, onRecord: (record: HsCodeParsedRecord) => Promise<void>): Promise<void> {
        return new Promise((resolve, reject) => {
            const csvString = fileBuffer.toString('utf-8');
            let rowCount = 0;

            Papa.parse(csvString, {
                header: true,
                skipEmptyLines: 'greedy',
                chunkSize: 1024 * 1024 * 2, // 2MB
                chunk: async (results, parser) => {
                    parser.pause();
                    for (const row of results.data) {
                        if (!this.isEmptyRow(row)) {
                            await onRecord({
                                row: ++rowCount + 1,
                                data: this.mapColumns(row),
                            });
                        }
                    }
                    parser.resume();
                },
                complete: () => {
                    this.logger.log(`Streamed ${rowCount} HS Code records from CSV`);
                    resolve();
                },
                error: (error) => {
                    this.logger.error(`CSV streaming error: ${error.message}`);
                    reject(new Error(`Failed to stream CSV: ${error.message}`));
                },
            });
        });
    }

    async parseCSV(fileBuffer: Buffer): Promise<HsCodeParsedRecord[]> {
        const records: HsCodeParsedRecord[] = [];
        await this.parseCSVStreaming(fileBuffer, async (rec) => {
            records.push(rec);
        });
        return records;
    }

    /**
     * Parse Excel file with memory optimization
     */
    async parseExcelStreaming(fileBuffer: Buffer, onRecord: (record: HsCodeParsedRecord) => Promise<void>): Promise<void> {
        try {
            const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            if (!worksheet) return;

            const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
            const headers: string[] = [];
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cell = worksheet[XLSX.utils.encode_cell({ r: range.s.r, c: C })];
                headers.push(cell ? cell.v : `UNKNOWN_${C}`);
            }

            let rowCount = 0;
            for (let R = range.s.r + 1; R <= range.e.r; ++R) {
                const rowObj: any = {};
                let hasData = false;
                for (let C = range.s.c; C <= range.e.c; ++C) {
                    const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: C })];
                    if (cell && cell.v !== null) {
                        rowObj[headers[C]] = cell.v;
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
            this.logger.log(`Processed ${rowCount} HS Code records from Excel`);
        } catch (error) {
            this.logger.error(`Excel processing error: ${error.message}`);
            throw new Error(`Failed to process Excel: ${error.message}`);
        }
    }

    async parseExcel(fileBuffer: Buffer): Promise<HsCodeParsedRecord[]> {
        const records: HsCodeParsedRecord[] = [];
        await this.parseExcelStreaming(fileBuffer, async (rec) => {
            records.push(rec);
        });
        return records;
    }

    /**
     * Auto-detect and parse file (Streaming version)
     */
    async parseFileStreaming(fileBuffer: Buffer, filename: string, onRecord: (record: HsCodeParsedRecord) => Promise<void>): Promise<void> {
        const ext = filename.toLowerCase().split('.').pop();
        if (ext === 'csv') {
            return this.parseCSVStreaming(fileBuffer, onRecord);
        } else if (['xlsx', 'xls'].includes(ext as string)) {
            return this.parseExcelStreaming(fileBuffer, onRecord);
        } else {
            throw new Error(`Unsupported file format: ${ext}`);
        }
    }

    async parseFile(fileBuffer: Buffer, filename: string): Promise<HsCodeParsedRecord[]> {
        const records: HsCodeParsedRecord[] = [];
        await this.parseFileStreaming(fileBuffer, filename, async (rec) => {
            records.push(rec);
        });
        return records;
    }
}