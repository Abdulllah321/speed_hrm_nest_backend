import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!masterKeyString || masterKeyString.length < 32) {
    throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
  }
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const algorithm = 'aes-256-gcm';

  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(algorithm, masterKey, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

export interface ParsedTransferRow {
  rowNum: number;
  stockOutLocationName: string;
  codeTrOut: string;
  docNoOutInpl: string;
  docNoOut: string;
  documentDateOut: string;
  textLine: string;
  stockInLocationName: string;
  codeTrIn: string;
  barCode: string;
  quantity: number;
  receivingDocNoTrIn: string;
  receivingDocDate: string;
  remarks: string;
  documentStatus: string;
  generatedTrOutNo: string;
  generatedTrInNo: string;
}

export function readAndParseMdTransfers(filePath: string, maxRows: number = 100): ParsedTransferRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  const parsedRows: ParsedTransferRow[] = [];

  // Line 0 is header, Line 1 is separator, data starts from Line 2 (index 2)
  for (let i = 2; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine || rawLine.startsWith('---')) continue;

    const parts = rawLine.split('|').map((p) => p.trim());
    if (parts.length < 12) continue;

    const stockOutLocationName = parts[0] || '';
    const codeTrOut = parts[1] || '';
    const docNoOutInpl = parts[2] || '';
    const docNoOut = parts[3] || '';
    const documentDateOut = parts[4] || '';
    const textLine = parts[5] || '';
    const stockInLocationName = parts[6] || '';
    const codeTrIn = parts[7] || '';
    
    // Column index 9 is BarCode value, 10 is Quantity, 11 is ReceivingDocumentNo TR IN
    const rawBarCode = parts[9] || parts[8] || '';
    const barCode = rawBarCode.replace(/"/g, '').trim();

    const rawQty = parts[10] || '1';
    const quantity = parseFloat(rawQty) || 1;

    const receivingDocNoTrIn = parts[11] || '';
    const receivingDocDate = parts[12] || '';
    const remarks = parts[13] || '';
    const documentStatus = parts[14] || 'Approved / Closed';

    if (!codeTrOut || !codeTrIn || !barCode) continue;

    // Generate formatted Outlet TR OUT and TR IN Numbers (e.g. TROUT-001, TRIN-001)
    const numOutStr = docNoOut.replace(/\D/g, '') || '1';
    const numInStr = receivingDocNoTrIn.replace(/\D/g, '') || '1';

    const generatedTrOutNo = `TROUT-${numOutStr.padStart(3, '0')}`;
    const generatedTrInNo = `TRIN-${numInStr.padStart(3, '0')}`;

    parsedRows.push({
      rowNum: parsedRows.length + 1,
      stockOutLocationName,
      codeTrOut,
      docNoOutInpl,
      docNoOut,
      documentDateOut,
      textLine,
      stockInLocationName,
      codeTrIn,
      barCode,
      quantity,
      receivingDocNoTrIn,
      receivingDocDate,
      remarks,
      documentStatus,
      generatedTrOutNo,
      generatedTrInNo,
    });

    if (parsedRows.length >= maxRows) {
      break;
    }
  }

  return parsedRows;
}

async function processTransfersForTenant(
  prisma: PrismaClient,
  rows: ParsedTransferRow[],
  isDryRun: boolean = false
) {
  console.log(`\n==================================================`);
  console.log(`📦 ${isDryRun ? '[DRY RUN MODE]' : '[LIVE COMMIT MODE]'} Processing ${rows.length} rows into database...`);
  console.log(`==================================================\n`);

  let defaultWarehouse: any = null;
  if (!isDryRun) {
    defaultWarehouse = await prisma.warehouse.findFirst({
      where: { isDeleted: false },
    });

    if (!defaultWarehouse) {
      console.log(`🏭 Creating default Warehouse (MAIN-WH)...`);
      defaultWarehouse = await prisma.warehouse.create({
        data: {
          code: 'MAIN-WH',
          name: 'Main Central Warehouse',
          type: 'GENERAL',
          isActive: true,
        },
      });
    }
  } else {
    defaultWarehouse = { id: 'dry-run-wh-id', code: 'MAIN-WH', name: 'Main Central Warehouse' };
    console.log(`🏭 [DRY-RUN] Using Warehouse (MAIN-WH)`);
  }

  const locationCache = new Map<string, any>();
  const itemCache = new Map<string, any>();

  // 1. Locations & Items Setup
  for (const row of rows) {
    // FROM Location
    if (!locationCache.has(row.codeTrOut)) {
      if (!isDryRun) {
        let loc = await prisma.location.findFirst({
          where: { code: row.codeTrOut, isDeleted: false },
        });
        if (!loc) {
          console.log(`📍 Creating Location OUT: ${row.stockOutLocationName} (${row.codeTrOut})`);
          loc = await prisma.location.create({
            data: {
              code: row.codeTrOut,
              name: row.stockOutLocationName,
              warehouseId: defaultWarehouse.id,
              status: 'active',
            },
          });
        }
        locationCache.set(row.codeTrOut, loc);
      } else {
        console.log(`📍 [DRY-RUN] Location OUT verified/created: ${row.stockOutLocationName} (${row.codeTrOut})`);
        locationCache.set(row.codeTrOut, { id: `loc-${row.codeTrOut}`, code: row.codeTrOut, name: row.stockOutLocationName });
      }
    }

    // TO Location
    if (!locationCache.has(row.codeTrIn)) {
      if (!isDryRun) {
        let loc = await prisma.location.findFirst({
          where: { code: row.codeTrIn, isDeleted: false },
        });
        if (!loc) {
          console.log(`📍 Creating Location IN: ${row.stockInLocationName} (${row.codeTrIn})`);
          loc = await prisma.location.create({
            data: {
              code: row.codeTrIn,
              name: row.stockInLocationName,
              warehouseId: defaultWarehouse.id,
              status: 'active',
            },
          });
        }
        locationCache.set(row.codeTrIn, loc);
      } else {
        console.log(`📍 [DRY-RUN] Location IN verified/created: ${row.stockInLocationName} (${row.codeTrIn})`);
        locationCache.set(row.codeTrIn, { id: `loc-${row.codeTrIn}`, code: row.codeTrIn, name: row.stockInLocationName });
      }
    }

    // ITEM / Barcode
    if (!itemCache.has(row.barCode)) {
      if (!isDryRun) {
        let item = await prisma.item.findFirst({
          where: { barCode: row.barCode },
        });
        if (!item) {
          console.log(`🏷️ Creating Item for Barcode: ${row.barCode}`);
          item = await prisma.item.create({
            data: {
              itemId: `ITEM-${row.barCode}`,
              sku: row.barCode,
              barCode: row.barCode,
              description: `Imported Item (${row.barCode})`,
              unitPrice: 0,
              unitCost: 0,
              status: 'active',
              isActive: true,
            },
          });
        }
        itemCache.set(row.barCode, item);
      } else {
        console.log(`🏷️ [DRY-RUN] Item verified/created for Barcode: ${row.barCode}`);
        itemCache.set(row.barCode, { id: `item-${row.barCode}`, barCode: row.barCode });
      }
    }
  }

  // 2. Group rows into Transfer Requests by unique (codeTrOut, docNoOut, codeTrIn, receivingDocNoTrIn)
  const transferGroups = new Map<string, ParsedTransferRow[]>();
  for (const row of rows) {
    const groupKey = `${row.codeTrOut}_${row.docNoOut}_${row.codeTrIn}_${row.receivingDocNoTrIn}`;
    if (!transferGroups.has(groupKey)) {
      transferGroups.set(groupKey, []);
    }
    transferGroups.get(groupKey)!.push(row);
  }

  console.log(`\n📋 Grouped ${rows.length} rows into ${transferGroups.size} unique Transfer Requests.`);

  let stnCounter = 1;
  let processedCount = 0;

  for (const [groupKey, groupRows] of transferGroups.entries()) {
    const sample = groupRows[0];
    const fromLoc = locationCache.get(sample.codeTrOut);
    const toLoc = locationCache.get(sample.codeTrIn);

    // Sequential STN number format e.g. STN-00001
    const stnNumber = `STN-${String(stnCounter++).padStart(5, '0')}`;
    const outNo = sample.generatedTrOutNo; // e.g. TROUT-001
    const inNo = sample.generatedTrInNo;   // e.g. TRIN-001

    console.log(`\n--------------------------------------------------`);
    console.log(`${isDryRun ? '🔍 [DRY-RUN]' : '🚀 [CREATE]'} STN Number: ${stnNumber}`);
    console.log(`   - TR OUT No : ${outNo} (Outlet: ${sample.stockOutLocationName} [${sample.codeTrOut}])`);
    console.log(`   - TR IN No  : ${inNo} (Outlet: ${sample.stockInLocationName} [${sample.codeTrIn}])`);
    console.log(`   - Items Count: ${groupRows.length}`);
    console.log(`--------------------------------------------------`);

    let transferRequest: any = null;

    if (!isDryRun) {
      // Find or create TransferRequest by requestNo
      transferRequest = await prisma.transferRequest.findUnique({
        where: { requestNo: stnNumber },
      });

      if (!transferRequest) {
        transferRequest = await prisma.transferRequest.create({
          data: {
            requestNo: stnNumber,
            fromLocationId: fromLoc.id,
            toLocationId: toLoc.id,
            fromWarehouseId: defaultWarehouse.id,
            toWarehouseId: defaultWarehouse.id,
            status: sample.documentStatus === 'Approved / Closed' ? 'APPROVED' : 'COMPLETED',
            transferType: sample.codeTrOut.startsWith('C') ? 'WAREHOUSE_TO_OUTLET' : 'OUTLET_TO_OUTLET',
            notes: `TR OUT No: ${outNo} | TR IN No: ${inNo} | TextLine: ${sample.textLine} | Remarks: ${sample.remarks}`,
          },
        });
      }
    } else {
      transferRequest = { id: `tr-${stnNumber}`, requestNo: stnNumber };
    }

    // Process line items & stock movements
    for (const row of groupRows) {
      const item = itemCache.get(row.barCode);
      const qty = row.quantity;

      if (isDryRun) {
        console.log(`   🔸 [DRY-RUN Line #${row.rowNum}] Barcode: ${row.barCode} | Qty: ${qty} | STN: ${stnNumber} | OUT: ${outNo} | IN: ${inNo}`);
        processedCount++;
        continue;
      }

      // 1. Create TransferRequestItem
      const existingTrItem = await prisma.transferRequestItem.findFirst({
        where: {
          transferRequestId: transferRequest.id,
          itemId: item.id,
        },
      });

      if (!existingTrItem) {
        await prisma.transferRequestItem.create({
          data: {
            transferRequestId: transferRequest.id,
            itemId: item.id,
            quantity: qty,
            fulfilledQty: qty,
          },
        });
      }

      // 2. Adjust Stock at Source Location (Deduct Qty)
      const sourceInv = await prisma.inventoryItem.findFirst({
        where: {
          locationId: fromLoc.id,
          itemId: item.id,
        },
      });

      if (sourceInv) {
        await prisma.inventoryItem.update({
          where: { id: sourceInv.id },
          data: { quantity: { decrement: qty } },
        });
      } else {
        await prisma.inventoryItem.create({
          data: {
            warehouseId: defaultWarehouse.id,
            locationId: fromLoc.id,
            itemId: item.id,
            quantity: -qty,
            status: 'AVAILABLE',
          },
        });
      }

      // 3. Adjust Stock at Destination Location (Add Qty)
      const destInv = await prisma.inventoryItem.findFirst({
        where: {
          locationId: toLoc.id,
          itemId: item.id,
        },
      });

      if (destInv) {
        await prisma.inventoryItem.update({
          where: { id: destInv.id },
          data: { quantity: { increment: qty } },
        });
      } else {
        await prisma.inventoryItem.create({
          data: {
            warehouseId: defaultWarehouse.id,
            locationId: toLoc.id,
            itemId: item.id,
            quantity: qty,
            status: 'AVAILABLE',
          },
        });
      }

      // 4. Create StockMovement entry
      const movementNo = `MV-${row.codeTrOut}-${row.codeTrIn}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      await prisma.stockMovement.create({
        data: {
          movementNo,
          itemId: item.id,
          fromLocationId: fromLoc.id,
          toLocationId: toLoc.id,
          quantity: qty,
          type: 'TRANSFER',
          referenceType: 'TRANSFER_REQUEST',
          referenceId: transferRequest.id,
          notes: `STN: ${stnNumber} | TR OUT: ${outNo} | TR IN: ${inNo}`,
        },
      });

      // 5. Create StockLedger Entries (Outbound & Inbound)
      await prisma.stockLedger.create({
        data: {
          itemId: item.id,
          warehouseId: defaultWarehouse.id,
          locationId: fromLoc.id,
          qty: -qty,
          referenceType: 'TRANSFER_OUT',
          referenceId: transferRequest.id,
          movementType: 'TRANSFER',
        },
      });

      await prisma.stockLedger.create({
        data: {
          itemId: item.id,
          warehouseId: defaultWarehouse.id,
          locationId: toLoc.id,
          qty: qty,
          referenceType: 'TRANSFER_IN',
          referenceId: transferRequest.id,
          movementType: 'TRANSFER',
        },
      });

      processedCount++;
    }
  }

  console.log(`\n==================================================`);
  console.log(`✨ ${isDryRun ? '[DRY RUN SUMMARY]' : '[IMPORT SUMMARY]'}`);
  console.log(`   - Total Rows Parsed : ${rows.length}`);
  console.log(`   - Total Rows Created: ${processedCount}`);
  console.log(`   - STNs Generated    : ${transferGroups.size} (Format: STN-00001 to STN-${String(transferGroups.size).padStart(5, '0')})`);
  console.log(`   - TR OUT Format     : TROUT-001, TROUT-002, etc.`);
  console.log(`   - TR IN Format      : TRIN-001, TRIN-003, TRIN-049, etc.`);
  console.log(`==================================================\n`);
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('-d');

  console.log(`🚀 Starting Transfer Import Script (First 100 Rows)...`);
  if (isDryRun) {
    console.log(`⚠️ DRY RUN ACTIVATED: No database changes will be committed.`);
  }

  const mdFilePath = path.join(__dirname, '..', 'tableConvert.com_7s3gov.md');
  const rows = readAndParseMdTransfers(mdFilePath, 100);

  console.log(`📄 Successfully parsed ${rows.length} rows from markdown file.`);
  if (rows.length > 0) {
    console.log('\n🔍 Sample parsed row (#1):');
    console.log(`   - OUT Location: ${rows[0].stockOutLocationName} (${rows[0].codeTrOut})`);
    console.log(`   - OUT TR No   : ${rows[0].generatedTrOutNo}`);
    console.log(`   - IN Location : ${rows[0].stockInLocationName} (${rows[0].codeTrIn})`);
    console.log(`   - IN TR No    : ${rows[0].generatedTrInNo}`);
    console.log(`   - Barcode     : ${rows[0].barCode}`);
    console.log(`   - Quantity    : ${rows[0].quantity}`);
  }

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  // Check if Multi-Tenant setup with Master DB is active
  if (managementUrl && masterKey) {
    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const management = new ManagementClient({ adapter } as any);

    try {
      const companies = await management.company.findMany({
        where: { status: 'active' },
      });

      if (companies.length > 0) {
        console.log(`\n🏢 Found ${companies.length} tenant companies. Running transfer import for each...`);
        for (const company of companies) {
          console.log(`\n👉 Processing Tenant: ${company.name} (${company.code})`);
          let connectionString = company.dbUrl;
          if (company.dbPassword) {
            try {
              const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
              connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
            } catch (e) {
              console.warn(`  ⚠️ Decryption failed, using default connectionUrl`);
            }
          }

          if (!connectionString) continue;

          const tenantPool = new Pool({ connectionString });
          const tenantAdapter = new PrismaPg(tenantPool);
          const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

          try {
            await tenantPrisma.$connect();
            await processTransfersForTenant(tenantPrisma, rows, isDryRun);
          } finally {
            await tenantPrisma.$disconnect();
            await tenantPool.end();
          }
        }
        await management.$disconnect();
        await pool.end();
        return;
      }
    } catch (err: any) {
      console.warn(`ℹ️ Multi-tenant check failed (${err.message}). Falling back to single database...`);
    }
  }

  // Single DB Fallback using standard DATABASE_URL
  console.log('\n🔗 Running on primary DATABASE_URL...');
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    await processTransfersForTenant(prisma, rows, isDryRun);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('❌ Error executing script:', err);
  process.exit(1);
});
