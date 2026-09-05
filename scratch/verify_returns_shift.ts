import * as fs from 'fs';

const raw = fs.readFileSync('data/SS_LG2526_Sales_return.json', 'utf8');
const data = JSON.parse(raw);

console.log('Total return rows:', data.length);

let emptyBarcodeCount = 0;
let barcodeInQuantityCount = 0;
let normalBarcodeCount = 0;

for (let i = 0; i < data.length; i++) {
  const row = data[i];
  if (row.Barcode && row.Barcode.trim().length > 0) {
    normalBarcodeCount++;
  } else {
    emptyBarcodeCount++;
    const cleanQty = String(row.Quantity || '').replace(/['"]/g, '').trim();
    if (cleanQty.length >= 8) {
      barcodeInQuantityCount++;
    }
  }
}

console.log('Normal Barcode count:', normalBarcodeCount);
console.log('Empty Barcode count:', emptyBarcodeCount);
console.log('Barcode in Quantity count:', barcodeInQuantityCount);

// Sample first 5
for (let i = 0; i < Math.min(5, data.length); i++) {
  const r = data[i];
  const barcode = r.Barcode || String(r.Quantity).replace(/['"]/g, '').trim();
  const qty = r.Barcode ? r.Quantity : r.UnitPrice;
  const unitPrice = r.Barcode ? r.UnitPrice : r.TaxRate1;
  const taxRate = r.Barcode ? r.TaxRate1 : r.Price_W_O_T;
  const saleDoc = r.Barcode ? r.FKInvoiceNumber_Sale : r.DocumentDate_Sale;
  const saleDate = r.Barcode ? r.DocumentDate_Sale : r.FKInvoiceNumber_Exchange;
  const exchangeDoc = r.Barcode ? r.FKInvoiceNumber_Exchange : r.DocumentDate_Exchange;
  const totalVal = r.Barcode ? r['Value Incl Sales Tax'] : r.FKInvoiceNumber_Sale;

  console.log(`\nRow ${i + 1}:`);
  console.log({
    docNo: r.DocumentNumber,
    docDate: r.DocumentDate,
    subType: r['Sub Type'],
    barcode,
    qty,
    unitPrice,
    taxRate,
    totalVal,
    saleDoc,
    saleDate,
    exchangeDoc
  });
}
