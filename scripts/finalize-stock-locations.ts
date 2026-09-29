import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';

function decrypt(encryptedText: string, masterKeyString: string): string {
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, Buffer.from(encryptedText.split(':')[0], 'hex'));
  decipher.setAuthTag(Buffer.from(encryptedText.split(':')[1], 'hex'));
  let decrypted = decipher.update(encryptedText.split(':')[2], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function main() {
  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  let pool: Pool;
  if (managementUrl && masterKey) {
    const mgmtPool = new Pool({ connectionString: managementUrl });
    const mgmtAdapter = new PrismaPg(mgmtPool);
    const management = new ManagementClient({ adapter: mgmtAdapter } as any);
    const company = await management.company.findFirst({ where: { status: 'active' } });
    await management.$disconnect();
    await mgmtPool.end();

    let connStr = company!.dbUrl;
    if (!connStr && company!.dbPassword) {
      connStr = `postgresql://${company!.dbUser}:${encodeURIComponent(decrypt(company!.dbPassword, masterKey))}@${company!.dbHost || 'localhost'}:${company!.dbPort || 5432}/${company!.dbName}?schema=public`;
    }
    pool = new Pool({ connectionString: connStr || process.env.DATABASE_URL });
  } else {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }

  console.log('🔄 Moving any residual entries from non-stock locations to their official WH- stock locations...');

  // Move C20001 non-stock location -> WH-C20001 stock location
  const locC20001Res = await pool.query(`SELECT id FROM "Location" WHERE code = 'C20001'`);
  const whLocC20001Res = await pool.query(`SELECT id FROM "Location" WHERE code = 'WH-C20001'`);
  if (locC20001Res.rows[0] && whLocC20001Res.rows[0]) {
    await pool.query(`UPDATE stock_ledgers SET location_id = $1 WHERE location_id = $2`, [whLocC20001Res.rows[0].id, locC20001Res.rows[0].id]);
    await pool.query(`UPDATE "StockMovement" SET "fromLocationId" = $1 WHERE "fromLocationId" = $2`, [whLocC20001Res.rows[0].id, locC20001Res.rows[0].id]);
    await pool.query(`UPDATE "StockMovement" SET "toLocationId" = $1 WHERE "toLocationId" = $2`, [whLocC20001Res.rows[0].id, locC20001Res.rows[0].id]);
    await pool.query(`UPDATE "TransferRequest" SET "fromLocationId" = $1 WHERE "fromLocationId" = $2`, [whLocC20001Res.rows[0].id, locC20001Res.rows[0].id]);
    await pool.query(`UPDATE "TransferRequest" SET "toLocationId" = $1 WHERE "toLocationId" = $2`, [whLocC20001Res.rows[0].id, locC20001Res.rows[0].id]);
    console.log('✅ C20001 -> WH-C20001 transferred.');
  }

  // Move C30001 non-stock location -> WH-C30001 stock location
  const locC30001Res = await pool.query(`SELECT id FROM "Location" WHERE code = 'C30001'`);
  const whLocC30001Res = await pool.query(`SELECT id FROM "Location" WHERE code = 'WH-C30001'`);
  if (locC30001Res.rows[0] && whLocC30001Res.rows[0]) {
    await pool.query(`UPDATE stock_ledgers SET location_id = $1 WHERE location_id = $2`, [whLocC30001Res.rows[0].id, locC30001Res.rows[0].id]);
    await pool.query(`UPDATE "StockMovement" SET "fromLocationId" = $1 WHERE "fromLocationId" = $2`, [whLocC30001Res.rows[0].id, locC30001Res.rows[0].id]);
    await pool.query(`UPDATE "StockMovement" SET "toLocationId" = $1 WHERE "toLocationId" = $2`, [whLocC30001Res.rows[0].id, locC30001Res.rows[0].id]);
    await pool.query(`UPDATE "TransferRequest" SET "fromLocationId" = $1 WHERE "fromLocationId" = $2`, [whLocC30001Res.rows[0].id, locC30001Res.rows[0].id]);
    await pool.query(`UPDATE "TransferRequest" SET "toLocationId" = $1 WHERE "toLocationId" = $2`, [whLocC30001Res.rows[0].id, locC30001Res.rows[0].id]);
    console.log('✅ C30001 -> WH-C30001 transferred.');
  }

  // Move C40001 non-stock location -> WH-C40001 stock location
  const locC40001Res = await pool.query(`SELECT id FROM "Location" WHERE code = 'C40001'`);
  const whLocC40001Res = await pool.query(`SELECT id FROM "Location" WHERE code = 'WH-C40001'`);
  if (locC40001Res.rows[0] && whLocC40001Res.rows[0]) {
    await pool.query(`UPDATE stock_ledgers SET location_id = $1 WHERE location_id = $2`, [whLocC40001Res.rows[0].id, locC40001Res.rows[0].id]);
    await pool.query(`UPDATE "StockMovement" SET "fromLocationId" = $1 WHERE "fromLocationId" = $2`, [whLocC40001Res.rows[0].id, locC40001Res.rows[0].id]);
    await pool.query(`UPDATE "StockMovement" SET "toLocationId" = $1 WHERE "toLocationId" = $2`, [whLocC40001Res.rows[0].id, locC40001Res.rows[0].id]);
    await pool.query(`UPDATE "TransferRequest" SET "fromLocationId" = $1 WHERE "fromLocationId" = $2`, [whLocC40001Res.rows[0].id, locC40001Res.rows[0].id]);
    await pool.query(`UPDATE "TransferRequest" SET "toLocationId" = $1 WHERE "toLocationId" = $2`, [whLocC40001Res.rows[0].id, locC40001Res.rows[0].id]);
    console.log('✅ C40001 -> WH-C40001 transferred.');
  }

  // Sync InventoryItem table
  await pool.query(`DELETE FROM "InventoryItem"`);
  await pool.query(`
    INSERT INTO "InventoryItem" (id, "warehouseId", "locationId", "itemId", quantity, status, "createdAt", "updatedAt")
    SELECT 
      gen_random_uuid(),
      sl.warehouse_id,
      sl.location_id,
      sl.item_id,
      SUM(sl.qty) as quantity,
      'AVAILABLE',
      NOW(),
      NOW()
    FROM stock_ledgers sl
    GROUP BY sl.warehouse_id, sl.location_id, sl.item_id
    HAVING SUM(sl.qty) <> 0
  `);

  console.log('✅ InventoryItem table rebuilt.');

  // Final count of ledgers on non-stock locations:
  const remaining = await pool.query(`
    SELECT count(*) 
    FROM stock_ledgers sl
    JOIN "Location" loc ON sl.location_id = loc.id
    WHERE loc.is_stock_location = false
  `);
  console.log(`Remaining stock ledger entries on non-stock locations: ${remaining.rows[0].count}`);

  await pool.end();
}

main().catch(console.error);
