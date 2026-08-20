import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import fs from 'fs';
import readline from 'readline';
import { Pool } from 'pg';

async function reconcilePosSales() {
  const filePath = process.argv[2] || path.resolve(__dirname, '../../s');
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
  
  const fileBarcodeQtyByOrder = new Map<string, Map<string, number>>();
  const fileTotalQtyByOrder = new Map<string, number>();

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

    if (!fileBarcodeQtyByOrder.has(orderNumber)) {
      fileBarcodeQtyByOrder.set(orderNumber, new Map<string, number>());
    }
    const orderMap = fileBarcodeQtyByOrder.get(orderNumber)!;
    orderMap.set(barcode, (orderMap.get(barcode) || 0) + qty);

    fileTotalQtyByOrder.set(orderNumber, (fileTotalQtyByOrder.get(orderNumber) || 0) + qty);
  }

  const uniqueFileOrdersCount = fileTotalQtyByOrder.size;
  let totalFileQty = 0;
  for (const q of fileTotalQtyByOrder.values()) totalFileQty += q;

  console.log(`✔ Read ${fileLineCount.toLocaleString()} detail rows from file.`);
  console.log(`✔ Found ${uniqueFileOrdersCount.toLocaleString()} unique orders in file (Total Qty: ${totalFileQty.toLocaleString()}).\n`);

  // 2. Resolve database connection URL
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

      const dbBarcodeQtyByOrder = new Map<string, Map<string, number>>();
      const dbTotalQtyByOrder = new Map<string, number>();

      for (const row of dbSalesItems) {
        const orderNum = row.orderNumber;
        const barcode = row.barCode;
        const qty = parseInt(row.quantity, 10);

        if (!dbBarcodeQtyByOrder.has(orderNum)) {
          dbBarcodeQtyByOrder.set(orderNum, new Map<string, number>());
        }
        const orderMap = dbBarcodeQtyByOrder.get(orderNum)!;
        orderMap.set(barcode, (orderMap.get(barcode) || 0) + qty);

        dbTotalQtyByOrder.set(orderNum, (dbTotalQtyByOrder.get(orderNum) || 0) + qty);
      }

      const uniqueDbOrdersCount = dbTotalQtyByOrder.size;
      let totalDbQty = 0;
      for (const q of dbTotalQtyByOrder.values()) totalDbQty += q;

      console.log(`✔ DB (${dbName}) contains ${uniqueDbOrdersCount.toLocaleString()} orders for SI-SSDMC26-% (Total DB Qty: ${totalDbQty.toLocaleString()}).\n`);

      // Perform 3-Way Reconciliation
      interface DiscrepancyRow {
        orderNumber: string;
        barcode: string;
        fileQty: number;
        dbQty: number;
        variance: number; // dbQty - fileQty
        issueType: 'MISSING_IN_DB' | 'MISSING_IN_FILE' | 'QTY_MISMATCH';
      }

      const discrepancies: DiscrepancyRow[] = [];
      const allOrderNumbers = new Set<string>([
        ...fileTotalQtyByOrder.keys(),
        ...dbTotalQtyByOrder.keys(),
      ]);

      let matchedOrderCount = 0;
      let mismatchedOrderCount = 0;
      let missingOrdersInDb = 0;
      let missingOrdersInFile = 0;

      for (const orderNum of allOrderNumbers) {
        const fileMap = fileBarcodeQtyByOrder.get(orderNum);
        const dbMap = dbBarcodeQtyByOrder.get(orderNum);

        if (!dbMap) {
          missingOrdersInDb++;
          mismatchedOrderCount++;
          if (fileMap) {
            for (const [barcode, fQty] of fileMap.entries()) {
              discrepancies.push({
                orderNumber: orderNum,
                barcode,
                fileQty: fQty,
                dbQty: 0,
                variance: -fQty,
                issueType: 'MISSING_IN_DB',
              });
            }
          }
          continue;
        }

        if (!fileMap) {
          missingOrdersInFile++;
          mismatchedOrderCount++;
          for (const [barcode, dQty] of dbMap.entries()) {
            discrepancies.push({
              orderNumber: orderNum,
              barcode,
              fileQty: 0,
              dbQty: dQty,
              variance: dQty,
              issueType: 'MISSING_IN_FILE',
            });
          }
          continue;
        }

        const allBarcodesInOrder = new Set<string>([
          ...fileMap.keys(),
          ...dbMap.keys(),
        ]);

        let hasMismatch = false;

        for (const barcode of allBarcodesInOrder) {
          const fQty = fileMap.get(barcode) || 0;
          const dQty = dbMap.get(barcode) || 0;

          if (fQty !== dQty) {
            hasMismatch = true;
            let issue: DiscrepancyRow['issueType'] = 'QTY_MISMATCH';
            if (fQty > 0 && dQty === 0) issue = 'MISSING_IN_DB';
            else if (fQty === 0 && dQty > 0) issue = 'MISSING_IN_FILE';

            discrepancies.push({
              orderNumber: orderNum,
              barcode,
              fileQty: fQty,
              dbQty: dQty,
              variance: dQty - fQty,
              issueType: issue,
            });
          }
        }

        if (hasMismatch) {
          mismatchedOrderCount++;
        } else {
          matchedOrderCount++;
        }
      }

      console.log(`=======================================================`);
      console.log(`📊 RECONCILIATION SUMMARY REPORT (DB: ${dbName})`);
      console.log(`=======================================================`);
      console.log(`Total Orders Checked:        ${allOrderNumbers.size.toLocaleString()}`);
      console.log(`✅ Fully Matched Orders:     ${matchedOrderCount.toLocaleString()}`);
      console.log(`⚠️ Mismatched Orders:        ${mismatchedOrderCount.toLocaleString()}`);
      console.log(`   - Orders Missing in DB:   ${missingOrdersInDb.toLocaleString()}`);
      console.log(`   - Orders Missing in File: ${missingOrdersInFile.toLocaleString()}`);
      console.log(`-------------------------------------------------------`);
      console.log(`Total File Items Quantity:   ${totalFileQty.toLocaleString()}`);
      console.log(`Total DB Items Quantity:     ${totalDbQty.toLocaleString()}`);
      console.log(`Net Quantity Variance:       ${(totalDbQty - totalFileQty).toLocaleString()}`);
      console.log(`Total Line Item Mismatches:  ${discrepancies.length.toLocaleString()}`);
      console.log(`=======================================================\n`);

      const csvOutputPath = path.resolve(__dirname, '../../pos_reconciliation_mismatches.csv');
      const csvHeader = 'OrderNumber,Barcode,FileQty,DbQty,Variance,IssueType\n';
      const csvLines = discrepancies
        .map(
          (d) =>
            `"${d.orderNumber}","${d.barcode}",${d.fileQty},${d.dbQty},${d.variance},"${d.issueType}"`,
        )
        .join('\n');

      fs.writeFileSync(csvOutputPath, csvHeader + csvLines);
      console.log(`📄 Detailed mismatch audit report saved to:`);
      console.log(`   👉 ${csvOutputPath}\n`);

      if (discrepancies.length > 0) {
        console.log(`🔍 Sample Discrepancies (Top 15):`);
        console.table(discrepancies.slice(0, 15));
      }

      await pool.end();
      break; // Successfully processed main tenant database
    } catch (err: any) {
      console.log(`⚠️ Database ${dbName} query failed: ${err.message}`);
      await pool.end();
    }
  }
}

reconcilePosSales();
