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
    }

    /**
     * Parse CSV file
     */
    async parseCSV(fileBuffer: Buffer): Promise<HsCodeParsedRecord[]> {
        return new Promise((resolve, reject) => {
            const csvString = fileBuffer.toString('utf-8');
            this.logger.log(`Starting CSV parsing. File size: ${fileBuffer.length} bytes`);

            Papa.parse(csvString, {
                header: true,
                skipEmptyLines: false,
                complete: (results) => {
                    this.logger.log(`Papa.parse completed. Total rows: ${results.data.length}`);
                    
                    if (results.errors.length > 0) {
                        this.logger.warn(`Parse errors: ${JSON.stringify(results.errors)}`);
                    }

                    const records: HsCodeParsedRecord[] = [];

                    results.data.forEach((row: any, index: number) => {
                        // Skip empty rows but log them
                        if (this.isEmptyRow(row)) {
                            this.logger.debug(`Skipping empty row at line ${index + 2}`);
                            return;
                        }

                        records.push({
                            row: index + 2, // +2 because: +1 for header, +1 for 1-indexed
                            data: this.mapColumns(row),
                        });
                    });

                    this.logger.log(`Parsed ${records.length} valid HS Code records from CSV (Total rows: ${results.data.length})`);
                    resolve(records);
                },
                error: (error) => {
                    this.logger.error(`CSV parsing error: ${error.message}`);
                    reject(new Error(`Failed to parse CSV: ${error.message}`));
                },
            });
        });
    }

    /**
     * Parse Excel file (.xlsx, .xls)
     */
    async parseExcel(fileBuffer: Buffer): Promise<HsCodeParsedRecord[]> {
        try {
            this.logger.log(`Parsing HS Code Excel file (${fileBuffer ? fileBuffer.length : 0} bytes)`);

            const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
            this.logger.debug(`Workbook sheet names: ${workbook.SheetNames.join(', ')}`);

            const sheetName = workbook.SheetNames[0]; // Use first sheet
            const worksheet = workbook.Sheets[sheetName];

            if (!worksheet) {
                this.logger.warn(`Worksheet "${sheetName}" not found or empty`);
                return [];
            }

            // Convert to JSON with header row
            const json = XLSX.utils.sheet_to_json(worksheet, { defval: null });
            this.logger.log(`XLSX converted ${json.length} rows to JSON`);

            const records: HsCodeParsedRecord[] = [];

            json.forEach((row: any, index: number) => {
                // Skip empty rows
                if (this.isEmptyRow(row)) {
                    this.logger.debug(`Skipping empty Excel row at line ${index + 2}`);
                    return;
                }

                records.push({
                    row: index + 2, // +2 for header and 1-indexed
                    data: this.mapColumns(row),
                });
            });

            this.logger.log(`Parsed ${records.length} valid HS Code records from Excel (Total rows: ${json.length})`);
            return records;
        } catch (error) {
            this.logger.error(`Excel parsing error: ${error.message}`, error.stack);
            throw new Error(`Failed to parse Excel: ${error.message}`);
        }
    }

    /**
     * Auto-detect and parse file based on extension
     */
    async parseFile(fileBuffer: Buffer, filename: string): Promise<HsCodeParsedRecord[]> {
        const ext = filename.toLowerCase().split('.').pop();

        if (ext === 'csv') {
            return this.parseCSV(fileBuffer);
        } else if (['xlsx', 'xls'].includes(ext as string)) {
            return this.parseExcel(fileBuffer);
        } else {
            throw new Error(`Unsupported file format: ${ext}. Please upload CSV or Excel files.`);
        }
    }
}