import * as XLSX from 'xlsx';
import * as path from 'path';

async function main() {
    const filePath = path.join(__dirname, '../uploads/bulk/upload-5dc3bdcf-8b99-40e9-a3c0-f2aa1d8e47a4.xlsx');
    console.log('Reading Excel file:', filePath);

    const workbook = XLSX.readFile(filePath, { cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    console.log(`Sheet: ${sheetName}, Range: ${worksheet['!ref']}`);

    // Let's determine header row index like CsvParserService does
    let headerRowIndex = range.s.r;
    if (range.e.r - range.s.r >= 1) {
        const firstRowCells: string[] = [];
        const secondRowCells: string[] = [];
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const cell1 = worksheet[XLSX.utils.encode_cell({ r: range.s.r, c: C })];
            const cell2 = worksheet[XLSX.utils.encode_cell({ r: range.s.r + 1, c: C })];
            firstRowCells.push(cell1 && cell1.v !== undefined && cell1.v !== null ? String(cell1.v).trim().toLowerCase() : '');
            secondRowCells.push(cell2 && cell2.v !== undefined && cell2.v !== null ? String(cell2.v).trim().toLowerCase() : '');
        }
        
        const hasEmployeeIdInSecondRow = secondRowCells.some(v => 
            v === 'employee id' || v === 'employee_id' || v === 'employee name' || v === 'employee_name'
        );
        const hasGroupHeadersInFirstRow = firstRowCells.some(v =>
            ['identity', 'employment', 'personal', 'contact', 'financial', 'audit'].includes(v)
        );
        
        if (hasEmployeeIdInSecondRow || hasGroupHeadersInFirstRow) {
            headerRowIndex = range.s.r + 1;
        }
    }

    const headers: string[] = [];
    for (let C = range.s.c; C <= range.e.c; ++C) {
        const cell = worksheet[XLSX.utils.encode_cell({ r: headerRowIndex, c: C })];
        headers.push(cell && cell.v !== null ? String(cell.v).trim() : `UNKNOWN_${C}`);
    }

    console.log('Headers:', headers);

    const empIdCounts = new Map<string, number[]>();
    const cnicCounts = new Map<string, number[]>();
    const emailCounts = new Map<string, number[]>();

    let totalRows = 0;
    for (let R = headerRowIndex + 1; R <= range.e.r; ++R) {
        const rowObj: any = {};
        let hasData = false;
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: C })];
            if (cell && cell.v !== null) {
                rowObj[headers[C]] = cell.v;
                hasData = true;
            }
        }

        if (hasData) {
            totalRows++;
            const rowNumber = R + 1;
            const empId = String(rowObj['Employee ID'] || rowObj.employeeId || rowObj.employeeID || '').trim();
            const cnic = String(rowObj['CNIC Number'] || rowObj.cnicNumber || rowObj.CNIC || '').trim();
            const email = String(rowObj['Official Email'] || rowObj.officialEmail || '').trim().toLowerCase();

            if (empId) {
                if (!empIdCounts.has(empId)) empIdCounts.set(empId, []);
                empIdCounts.get(empId)!.push(rowNumber);
            }
            if (cnic) {
                if (!cnicCounts.has(cnic)) cnicCounts.set(cnic, []);
                cnicCounts.get(cnic)!.push(rowNumber);
            }
            if (email) {
                if (!emailCounts.has(email)) emailCounts.set(email, []);
                emailCounts.get(email)!.push(rowNumber);
            }
        }
    }

    console.log(`Total rows processed: ${totalRows}`);

    console.log('\n--- Duplicate Employee IDs ---');
    for (const [key, rows] of empIdCounts.entries()) {
        if (rows.length > 1) {
            console.log(`Employee ID "${key}" found on rows: ${rows.join(', ')}`);
        }
    }

    console.log('\n--- Duplicate CNIC Numbers ---');
    for (const [key, rows] of cnicCounts.entries()) {
        if (rows.length > 1) {
            console.log(`CNIC "${key}" found on rows: ${rows.join(', ')}`);
        }
    }

    console.log('\n--- Duplicate Emails ---');
    for (const [key, rows] of emailCounts.entries()) {
        if (rows.length > 1) {
            console.log(`Email "${key}" found on rows: ${rows.join(', ')}`);
        }
    }
}

main().catch(console.error);
