const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, 'IMPORT MIS.xls');
const workbook = XLSX.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

// Find the row that contains "S.No" or "GRN" or "DATE"
const headerRowIndex = data.findIndex(row =>
    row && row.some(cell => typeof cell === 'string' && (cell.includes('LC') || cell.includes('GRN') || cell.includes('DATE')))
);

if (headerRowIndex !== -1) {
    console.log('--- HEADERS FOUND ---');
    console.log(JSON.stringify(data[headerRowIndex], null, 2));
    console.log('--- DATA ROWS ---');
    for (let i = 1; i <= 20; i++) {
        if (data[headerRowIndex + i]) {
            console.log(`Row ${headerRowIndex + i}:`, JSON.stringify(data[headerRowIndex + i], null, 2));
        }
    }
} else {
    console.log('Header row not found');
    data.slice(0, 20).forEach((row, i) => console.log(`Row ${i}:`, JSON.stringify(row)));
}
