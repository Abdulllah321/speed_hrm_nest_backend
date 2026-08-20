import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import fs from 'fs';
import readline from 'readline';
import { Pool } from 'pg';

async function reconcilePosSales() {
  let filePath = process.argv[2] || path.resolve(__dirname, '../../s');
  if (!fs.existsSync(filePath)) {
    filePath = path.resolve(__dirname, '../s');
  }

  console.log(`=======================================================`);
  console.log(`🚀 Starting POS Sales & Barcode Reconciliation Audit`);
  console.log(`📁 File Source: ${filePath}`);
  console.log(`=======================================================\n`);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ Error: File not found at ${filePath}`);
    process.exit(1);
  }

  // 1. Read and parse file
  console.log(`📖 Reading and parsing input dataset...`);
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let isHeader = true;
  let fileLineCount = 0;
  
  // File Storage:
  const fileBarcodeTotalQty = new Map<string, number>();
  const fileOrderTotalQty = new Map<string, number>();
  const fileBarcodeQtyByOrder = new Map<string, Map<string, number>>();

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (isHeader) {
      isHeader = false;
      if (trimmed.toLowerCase().includes('documentnumber')) continue;
    }

    const parts = trimmed.split(/\t|,|\s+/);
    if (parts.length < 3) continue;

    const docNumRaw = parts[0].trim();
    const barcode = parts[2] ? parts[2].trim() : '';
    const qty = parts[3] ? parseInt(parts[3].trim(), 10) : 1;

    if (!docNumRaw || !barcode || isNaN(qty)) continue;

    fileLineCount++;
    const docSeq = parseInt(docNumRaw, 10);
    const paddedSeq = isNaN(docSeq) ? docNumRaw : String(docSeq).padStart(5, '0');
    const orderNumber = `SI-SSDMC26-${paddedSeq}`;

    // 1a. Store-wide barcode total
    fileBarcodeTotalQty.set(barcode, (fileBarcodeTotalQty.get(barcode) || 0) + qty);

    // 1b. Order total
    fileOrderTotalQty.set(orderNumber, (fileOrderTotalQty.get(orderNumber) || 0) + qty);

    // 1c. Order + Barcode detail
    if (!fileBarcodeQtyByOrder.has(orderNumber)) {
      fileBarcodeQtyByOrder.set(orderNumber, new Map<string, number>());
    }
    const orderMap = fileBarcodeQtyByOrder.get(orderNumber)!;
    orderMap.set(barcode, (orderMap.get(barcode) || 0) + qty);
  }

  const uniqueFileOrdersCount = fileOrderTotalQty.size;
  let totalFileQty = 0;
  for (const q of fileBarcodeTotalQty.values()) totalFileQty += q;

  console.log(`✔ Read ${fileLineCount.toLocaleString()} detail rows from file.`);
  console.log(`✔ Found ${uniqueFileOrdersCount.toLocaleString()} unique orders in file.`);
  console.log(`✔ Found ${fileBarcodeTotalQty.size.toLocaleString()} unique barcodes in file (Total File Qty: ${totalFileQty.toLocaleString()}).\n`);

  // 2. Connect to Database
  let masterUrl = process.env.DATABASE_URL!;
  const dbNamesToTry = ['tenant_speed_main_mox1gfsi', 'spl_core_db'];

  const urlObj = new URL(masterUrl);
  const user = urlObj.username;
  const password = urlObj.password;
  const host = urlObj.hostname;
  const port = urlObj.port || '5432';

  for (const dbName of dbNamesToTry) {
    const connStr = `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=public`;
    console.log(`🔗 Connecting to database: ${dbName}...`);
    const pool = new Pool({ connectionString: connStr });

    try {
      const res = await pool.query<{
        orderNumber: string;
        barCode: string;
        quantity: string;
      }>(`
        SELECT 
          so."orderNumber",
          COALESCE(i."barCode", 'NO_BARCODE') AS "barCode",
          SUM(soi.quantity)::text             AS quantity
        FROM sales_orders so
        JOIN "Location" loc ON so.location_id = loc.id
        JOIN sales_order_items soi ON soi.sales_order_id = so.id
        LEFT JOIN "Item" i ON soi.item_id = i.id
        WHERE (loc.code = 'SS1002' OR loc.short_code = 'SS1002')
          AND loc."isDeleted" = false
          AND so."orderNumber" LIKE 'SI-SSDMC26-%'
        GROUP BY so."orderNumber", i."barCode";
      `);

      const dbSalesItems = res.rows;
      console.log(`✔ Fetched ${dbSalesItems.length.toLocaleString()} DB sales item rows for SS1002 in ${dbName}.`);

      if (dbSalesItems.length === 0) {
        await pool.end();
        continue;
      }

      // DB Storage
      const dbBarcodeTotalQty = new Map<string, number>();
      const dbOrderTotalQty = new Map<string, number>();
      const dbBarcodeQtyByOrder = new Map<string, Map<string, number>>();

      for (const row of dbSalesItems) {
        const orderNum = row.orderNumber;
        const barcode = row.barCode;
        const qty = parseInt(row.quantity, 10);

        dbBarcodeTotalQty.set(barcode, (dbBarcodeTotalQty.get(barcode) || 0) + qty);
        dbOrderTotalQty.set(orderNum, (dbOrderTotalQty.get(orderNum) || 0) + qty);

        if (!dbBarcodeQtyByOrder.has(orderNum)) {
          dbBarcodeQtyByOrder.set(orderNum, new Map<string, number>());
        }
        const orderMap = dbBarcodeQtyByOrder.get(orderNum)!;
        orderMap.set(barcode, (orderMap.get(barcode) || 0) + qty);
      }

      let totalDbQty = 0;
      for (const q of dbBarcodeTotalQty.values()) totalDbQty += q;

      console.log(`✔ DB (${dbName}) contains ${dbOrderTotalQty.size.toLocaleString()} orders for SI-SSDMC26-% (Total DB Qty: ${totalDbQty.toLocaleString()}).\n`);

      // =======================================================
      // A. STORE-WIDE BARCODE QUANTITY RECONCILIATION
      // =======================================================
      console.log(`📊 A. BARCODE-LEVEL RECONCILIATION (Store-Wide Total Qty per Barcode)`);
      console.log(`-------------------------------------------------------`);
      
      const allBarcodes = new Set<string>([
        ...fileBarcodeTotalQty.keys(),
        ...dbBarcodeTotalQty.keys(),
      ]);

      interface BarcodeMismatchRow {
        barcode: string;
        fileQty: number;
        dbQty: number;
        variance: number;
        status: 'MATCHED' | 'MISSING_IN_DB' | 'MISSING_IN_FILE' | 'QTY_MISMATCH';
      }

      const barcodeMismatches: BarcodeMismatchRow[] = [];
      let matchedBarcodeCount = 0;
      let mismatchedBarcodeCount = 0;

      for (const barcode of allBarcodes) {
        const fQty = fileBarcodeTotalQty.get(barcode) || 0;
        const dQty = dbBarcodeTotalQty.get(barcode) || 0;
        const variance = dQty - fQty;

        let status: BarcodeMismatchRow['status'] = 'MATCHED';
        if (fQty > 0 && dQty === 0) status = 'MISSING_IN_DB';
        else if (fQty === 0 && dQty > 0) status = 'MISSING_IN_FILE';
        else if (fQty !== dQty) status = 'QTY_MISMATCH';

        if (status === 'MATCHED') {
          matchedBarcodeCount++;
        } else {
          mismatchedBarcodeCount++;
          barcodeMismatches.push({ barcode, fileQty: fQty, dbQty: dQty, variance, status });
        }
      }

      console.log(`Total Barcodes Checked:    ${allBarcodes.size.toLocaleString()}`);
      console.log(`✅ Fully Matched Barcodes: ${matchedBarcodeCount.toLocaleString()}`);
      console.log(`⚠️ Mismatched Barcodes:    ${mismatchedBarcodeCount.toLocaleString()}`);
      console.log(`Net Store Quantity Diff:   ${(totalDbQty - totalFileQty).toLocaleString()}\n`);

      const barcodeCsvPath = path.resolve(__dirname, '../../pos_barcode_summary_reconciliation.csv');
      const barcodeCsvHeader = 'Barcode,FileTotalQty,DbTotalQty,Variance,Status\n';
      const barcodeCsvLines = barcodeMismatches
        .map((b) => `"${b.barcode}",${b.fileQty},${b.dbQty},${b.variance},"${b.status}"`)
        .join('\n');
      fs.writeFileSync(barcodeCsvPath, barcodeCsvHeader + barcodeCsvLines);
      console.log(`📄 Barcode Summary Audit CSV saved to: ${barcodeCsvPath}`);

      if (barcodeMismatches.length > 0) {
        console.log(`🔍 Top Barcode Discrepancies (Sample 10):`);
        console.table(barcodeMismatches.slice(0, 10));
      }

      // =======================================================
      // B. ORDER-LEVEL QUANTITY RECONCILIATION
      // =======================================================
      console.log(`\n📊 B. ORDER-LEVEL RECONCILIATION (Total Item Qty per Order Number)`);
      console.log(`-------------------------------------------------------`);
      
      const allOrders = new Set<string>([
        ...fileOrderTotalQty.keys(),
        ...dbOrderTotalQty.keys(),
      ]);

      interface OrderMismatchRow {
        orderNumber: string;
        fileTotalQty: number;
        dbTotalQty: number;
        variance: number;
        status: 'MATCHED' | 'MISSING_IN_DB' | 'MISSING_IN_FILE' | 'QTY_MISMATCH';
      }

      const orderMismatches: OrderMismatchRow[] = [];
      let matchedOrderCount = 0;
      let mismatchedOrderCount = 0;

      for (const orderNum of allOrders) {
        const fQty = fileOrderTotalQty.get(orderNum) || 0;
        const dQty = dbOrderTotalQty.get(orderNum) || 0;
        const variance = dQty - fQty;

        let status: OrderMismatchRow['status'] = 'MATCHED';
        if (fQty > 0 && dQty === 0) status = 'MISSING_IN_DB';
        else if (fQty === 0 && dQty > 0) status = 'MISSING_IN_FILE';
        else if (fQty !== dQty) status = 'QTY_MISMATCH';

        if (status === 'MATCHED') {
          matchedOrderCount++;
        } else {
          mismatchedOrderCount++;
          orderMismatches.push({ orderNumber: orderNum, fileTotalQty: fQty, dbTotalQty: dQty, variance, status });
        }
      }

      console.log(`Total Orders Checked:      ${allOrders.size.toLocaleString()}`);
      console.log(`✅ Fully Matched Orders:   ${matchedOrderCount.toLocaleString()}`);
      console.log(`⚠️ Mismatched Orders:      ${mismatchedOrderCount.toLocaleString()}\n`);

      const orderCsvPath = path.resolve(__dirname, '../../pos_order_summary_reconciliation.csv');
      const orderCsvHeader = 'OrderNumber,FileTotalQty,DbTotalQty,Variance,Status\n';
      const orderCsvLines = orderMismatches
        .map((o) => `"${o.orderNumber}",${o.fileTotalQty},${o.dbTotalQty},${o.variance},"${o.status}"`)
        .join('\n');
      fs.writeFileSync(orderCsvPath, orderCsvHeader + orderCsvLines);
      console.log(`📄 Order Summary Audit CSV saved to: ${orderCsvPath}`);

      if (orderMismatches.length > 0) {
        console.log(`🔍 Top Order Discrepancies (Sample 10):`);
        console.table(orderMismatches.slice(0, 10));
      }

      // =======================================================
      // C. LINE ITEM INVOICE DETAIL RECONCILIATION
      // =======================================================
      interface DetailMismatchRow {
        orderNumber: string;
        barcode: string;
        fileQty: number;
        dbQty: number;
        variance: number;
        issueType: 'MISSING_IN_DB' | 'MISSING_IN_FILE' | 'QTY_MISMATCH';
      }

      const detailDiscrepancies: DetailMismatchRow[] = [];

      for (const orderNum of allOrders) {
        const fileMap = fileBarcodeQtyByOrder.get(orderNum);
        const dbMap = dbBarcodeQtyByOrder.get(orderNum);

        const orderBarcodes = new Set<string>([
          ...(fileMap ? fileMap.keys() : []),
          ...(dbMap ? dbMap.keys() : []),
        ]);

        for (const b of orderBarcodes) {
          const fQty = fileMap?.get(b) || 0;
          const dQty = dbMap?.get(b) || 0;

          if (fQty !== dQty) {
            let issue: DetailMismatchRow['issueType'] = 'QTY_MISMATCH';
            if (fQty > 0 && dQty === 0) issue = 'MISSING_IN_DB';
            else if (fQty === 0 && dQty > 0) issue = 'MISSING_IN_FILE';

            detailDiscrepancies.push({
              orderNumber: orderNum,
              barcode: b,
              fileQty: fQty,
              dbQty: dQty,
              variance: dQty - fQty,
              issueType: issue,
            });
          }
        }
      }

      const detailCsvPath = path.resolve(__dirname, '../../pos_reconciliation_mismatches.csv');
      const detailCsvHeader = 'OrderNumber,Barcode,FileQty,DbQty,Variance,IssueType\n';
      const detailCsvLines = detailDiscrepancies
        .map((d) => `"${d.orderNumber}","${d.barcode}",${d.fileQty},${d.dbQty},${d.variance},"${d.issueType}"`)
        .join('\n');
      fs.writeFileSync(detailCsvPath, detailCsvHeader + detailCsvLines);
      console.log(`\n📄 Line Item Detailed Audit CSV saved to: ${detailCsvPath}`);

      await pool.end();
      break;
    } catch (err: any) {
      console.log(`⚠️ Database ${dbName} query failed: ${err.message}`);
      await pool.end();
    }
  }
}

reconcilePosSales();
