import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as Papa from 'papaparse';

export interface ParsedRecord {
    row: number;
    data: {
        concept?: string;
        description?: string;
        fob?: number;
        unitCost?: number;
        unitPrice?: number;
        taxRate1?: number;
        taxRate2?: number;
        discountStartDate?: Date | null;
        discountEndDate?: Date | null;
        discountRate?: number;
        discountAmount?: number;
        isActive?: boolean;
        sku?: string;
        size?: string;
        color?: string;
        division?: string;
        department?: string;
        productCategory?: string;
        silhouette?: string;
        class?: string;
        subclass?: string;
        channelClass?: string;
        season?: string;
        oldSeason?: string;
        gender?: string;
        case?: string;
        band?: string;
        movementType?: string;
        heelHeight?: string;
        width?: string;
        hsCode?: string;
        itemId?: string;
        barCode?: string;
        uom?: string;
        segment?: string;
    };
}

@Injectable()
export class CsvParserService {
    private readonly logger = new Logger(CsvParserService.name);

    /**
     * Normalize N/A values to null
     * Handles: N/A, n/a, N / A, n / a, null, empty strings, whitespace
     */
    private normalizeValue(value: any): any {
        if (value === null || value === undefined) return null;

        const strValue = String(value).trim();

        // Check for various N/A patterns
        const naPatterns = ['n/a', 'n / a', 'null', 'none', '-'];
        if (naPatterns.includes(strValue.toLowerCase()) || strValue === '') {
            return null;
        }

        return strValue;
    }

    /**
     * Check if a row is empty (all key fields are null/empty)
     * Performs case-insensitive lookup for keys
     */
    private isEmptyRow(row: any): boolean {
        if (!row) return true;

        const findValue = (key: string) => {
            const actualKey = Object.keys(row).find(k => k.toLowerCase() === key.toLowerCase());
            return actualKey ? row[actualKey] : null;
        };

        const keyFields = ['sku', 'itemId', 'description', 'unitPrice'];
        return keyFields.every(field => {
            const value = this.normalizeValue(findValue(field));
            return value === null || value === '';
        });
    }

    /**
     * Parse Date from various formats
     */
    private parseDate(value: any): Date | null {
        if (!value) return null;

        // Handle Excel numeric dates (serial numbers)
        // Excel stores dates as number of days since Dec 30, 1899
        let numericValue: number | null = null;
        if (typeof value === 'number') {
            numericValue = value;
        } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
            numericValue = parseInt(value.trim(), 10);
        }

        if (numericValue !== null) {
            try {
                // Convert Excel serial date to JS Date
                const date = new Date(Math.round((numericValue - 25569) * 86400 * 1000));
                return isNaN(date.getTime()) ? null : date;
            } catch {
                return null;
            }
        }

        const normalized = this.normalizeValue(value);
        if (normalized === null) return null;

        try {
            const date = new Date(normalized);
            return isNaN(date.getTime()) ? null : date;
        } catch {
            return null;
        }
    }

    /**
     * Parse number from string
     */
    private parseNumber(value: any): number | null {
        const normalized = this.normalizeValue(value);
        if (normalized === null) return null;

        const num = parseFloat(normalized);
        return isNaN(num) ? null : num;
    }

    /**
     * Parse boolean from various formats
     */
    private parseBoolean(value: any): boolean | null {
        const normalized = this.normalizeValue(value);
        if (normalized === null) return null;

        const lowerValue = normalized.toLowerCase();
        if (['true', 'yes', '1', 'active'].includes(lowerValue)) return true;
        if (['false', 'no', '0', 'inactive'].includes(lowerValue)) return false;

        return null;
    }



    /**
     * Helper to find a value in a row object using case-insensitive key matching
     */
    private getValue(row: any, key: string): any {
        if (!row) return null;
        // Try exact match first for performance
        if (row[key] !== undefined) return row[key];

        // Case-insensitive match
        const lowerKey = key.toLowerCase().replace(/\s/g, '');
        const actualKey = Object.keys(row).find(k =>
            k.toLowerCase().replace(/\s/g, '') === lowerKey
        );

        return actualKey ? row[actualKey] : null;
    }

    /**
     * Map Excel column names to schema field names
     */
    private mapColumns(row: any): ParsedRecord['data'] {
        return {
            concept: this.normalizeValue(this.getValue(row, 'Concept')),
            description: this.normalizeValue(this.getValue(row, 'Description')),
            fob: this.parseNumber(this.getValue(row, 'FOB')) as number,
            unitCost: this.parseNumber(this.getValue(row, 'UnitCost')) as number,
            unitPrice: this.parseNumber(this.getValue(row, 'UnitPrice')) as number,
            taxRate1: this.parseNumber(this.getValue(row, 'TaxRate1')) as number,
            taxRate2: this.parseNumber(this.getValue(row, 'TaxRate2')) as number,
            discountStartDate: this.parseDate(this.getValue(row, 'DiscountStartDate')),
            discountEndDate: this.parseDate(this.getValue(row, 'DiscountEndDate')),
            discountRate: this.parseNumber(this.getValue(row, 'DiscountRate')) as number,
            discountAmount: this.parseNumber(this.getValue(row, 'DiscountAmount')) as number,
            isActive: this.parseBoolean(this.getValue(row, 'IsActive')) as boolean,
            sku: this.normalizeValue(this.getValue(row, 'SKU')),
            size: this.normalizeValue(this.getValue(row, 'Size')),
            color: this.normalizeValue(this.getValue(row, 'Color')),
            division: this.normalizeValue(this.getValue(row, 'Division')),
            department: this.normalizeValue(this.getValue(row, 'Department')),
            productCategory: this.normalizeValue(this.getValue(row, 'ProductCategory')),
            silhouette: this.normalizeValue(this.getValue(row, 'Silhouette')),
            class: this.normalizeValue(this.getValue(row, 'Class')),
            subclass: this.normalizeValue(this.getValue(row, 'Subclass')),
            channelClass: this.normalizeValue(this.getValue(row, 'ChannelClass') || this.getValue(row, 'Channel Class')),
            season: this.normalizeValue(this.getValue(row, 'Season')),
            oldSeason: this.normalizeValue(this.getValue(row, 'OldSeason')),
            gender: this.normalizeValue(this.getValue(row, 'Gender')),
            case: this.normalizeValue(this.getValue(row, 'Case')),
            band: this.normalizeValue(this.getValue(row, 'Band')),
            movementType: this.normalizeValue(this.getValue(row, 'MovementType') || this.getValue(row, 'Movement Type')),
            heelHeight: this.normalizeValue(this.getValue(row, 'HeelHeight') || this.getValue(row, 'Heel Height')),
            width: this.normalizeValue(this.getValue(row, 'Width')),
            hsCode: this.normalizeValue(this.getValue(row, 'HSCode')),
            itemId: this.normalizeValue(this.getValue(row, 'ItemID')),
            barCode: this.normalizeValue(this.getValue(row, 'BarCode')),
            uom: this.normalizeValue(this.getValue(row, 'UOM')),
            segment: this.normalizeValue(this.getValue(row, 'Segment')),
        };
    }

    /**
     * Parse CSV file
     */
    async parseCSV(fileBuffer: Buffer): Promise<ParsedRecord[]> {
        return new Promise((resolve, reject) => {
            const csvString = fileBuffer.toString('utf-8');

            Papa.parse(csvString, {
                header: true,
                skipEmptyLines: false, // We'll handle empty rows manually
                complete: (results) => {
                    const records: ParsedRecord[] = [];

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

                    this.logger.log(`Parsed ${records.length} valid records from CSV (Total rows: ${results.data.length})`);
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
    async parseExcel(fileBuffer: Buffer): Promise<ParsedRecord[]> {
        try {
            this.logger.log(`Parsing Excel file (${fileBuffer ? fileBuffer.length : 0} bytes)`);

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

            this.logger.debug(`XLSX converted ${json.length} rows to JSON`);

            const records: ParsedRecord[] = [];

            json.forEach((row: any, index: number) => {
                // Skip empty rows
                if (this.isEmptyRow(row)) {
                    this.logger.debug(`Skipping empty row at line ${index + 2}`);
                    return;
                }

                records.push({
                    row: index + 2, // +2 for header and 1-indexed
                    data: this.mapColumns(row),
                });
            });

            this.logger.log(`Parsed ${records.length} valid records from Excel (Total rows: ${json.length})`);
            return records;
        } catch (error) {
            this.logger.error(`Excel parsing error: ${error.message}`);
            throw new Error(`Failed to parse Excel: ${error.message}`);
        }
    }

    /**
     * Auto-detect and parse file based on extension
     */
    async parseFile(fileBuffer: Buffer, filename: string): Promise<ParsedRecord[]> {
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
