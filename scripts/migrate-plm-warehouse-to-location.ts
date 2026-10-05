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

  console.log('🔄 Moving stock from PLM Warehouse to PLM Location...');

  const plmWarehouseRes = await pool.query(`SELECT id FROM "Warehouse" WHERE code = 'C20001' LIMIT 1`);
  const plmLocationRes = await pool.query(`SELECT id, warehouse_id FROM "Location" WHERE code = 'C20001' LIMIT 1`);

  if (plmWarehouseRes.rowCount > 0 && plmLocationRes.rowCount > 0) {
    const whId = plmWarehouseRes.rows[0].id;
    const locId = plmLocationRes.rows[0].id;
    const locWhId = plmLocationRes.rows[0].warehouse_id;

    console.log(`Found PLM Warehouse: ${whId}`);
    console.log(`Found PLM Location: ${locId} (warehouse_id: ${locWhId})`);

    // Update stock_ledgers
    // stock_ledgers requires warehouse_id to be non-null, so we just set location_id to the new PLM location
    // and keep the warehouse_id pointing to the PLM Warehouse.
    await pool.query(`
      UPDATE stock_ledgers 
      SET location_id = $1
      WHERE warehouse_id = $2 AND (location_id IS NULL OR location_id = $1)
    `, [locId, whId]);
    // Update TransferRequests
    await pool.query(`
      UPDATE "TransferRequest" 
      SET "fromLocationId" = $1, "fromWarehouseId" = NULL
      WHERE "fromWarehouseId" = $2 AND "fromLocationId" IS NULL
    `, [locId, whId]);

    await pool.query(`
      UPDATE "TransferRequest" 
      SET "toLocationId" = $1, "toWarehouseId" = NULL
      WHERE "toWarehouseId" = $2 AND "toLocationId" IS NULL
    `, [locId, whId]);
    console.log('✅ TransferRequests updated.');

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
    console.log('✅ InventoryItem table rebuilt and synced with ledgers.');
  } else {
    console.log('❌ Could not find either PLM Warehouse (C20001) or PLM Location (C20001). Please verify they both exist in the database.');
  }

  await pool.end();
}

main().catch(console.error);
