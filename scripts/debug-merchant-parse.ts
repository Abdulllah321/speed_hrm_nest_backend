import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
    const filePath = path.join(process.cwd(), 'uploads', 'bulk', 'merchant', 'merchant-upload-43e2f991-3ad9-4e26-8844-a7adcfee511a.xlsx');
    if (!fs.existsSync(filePath)) {
        console.error('File not found:', filePath);
        return;
    }

    console.log('Reading file:', filePath);
    const fileBuffer = fs.readFileSync(filePath);
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
        console.error('No worksheet found');
        return;
    }

    console.log('Sheet Name:', sheetName);
    console.log('Worksheet Ref:', worksheet['!ref']);

    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    console.log('Range:', range);

    // Find the actual header row index (skip leading blank rows / titles)
    let headerRowIdx = range.s.r;
    let foundHeader = false;
    // First pass: look for a row with at least 3 non-empty cells
    for (let R = range.s.r; R <= range.e.r; ++R) {
        let nonIdxCount = 0;
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: C })];
            if (cell && cell.v !== null && cell.v !== undefined && String(cell.v).trim() !== '') {
                nonIdxCount++;
            }
        }
        if (nonIdxCount >= 3) {
            headerRowIdx = R;
            foundHeader = true;
            break;
        }
    }
    // Second pass fallback: if no row with >= 3 cells, take the first row with >= 1 cell
    if (!foundHeader) {
        for (let R = range.s.r; R <= range.e.r; ++R) {
            let hasCells = false;
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: C })];
                if (cell && cell.v !== null && cell.v !== undefined && String(cell.v).trim() !== '') {
                    hasCells = true;
                    break;
                }
            }
            if (hasCells) {
                headerRowIdx = R;
                break;
            }
        }
    }

    console.log('Determined Header Row Index:', headerRowIdx);

    const headers: string[] = [];
    for (let C = range.s.c; C <= range.e.c; ++C) {
        const cell = worksheet[XLSX.utils.encode_cell({ r: headerRowIdx, c: C })];
        headers.push(cell && cell.v !== null && cell.v !== undefined ? String(cell.v).trim() : `UNKNOWN_${C}`);
    }
    console.log('Headers found:', headers);

    // Scan all rows to see if there is any data in columns 9-14
    console.log('\nChecking if columns 9-14 have any data in the entire sheet...');
    const colStats = Array(15).fill(0);
    for (let R = headerRowIdx + 1; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: C })];
            if (cell && cell.v !== null && cell.v !== undefined && String(cell.v).trim() !== '') {
                colStats[C]++;
            }
        }
    }
    for (let C = range.s.c; C <= range.e.c; ++C) {
        console.log(`Column ${C} (${headers[C]}): ${colStats[C]} non-empty cells`);
    }
}

main();
