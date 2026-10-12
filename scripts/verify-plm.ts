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

  const whId = 'ea97919e-4057-45c5-aff5-982bb2df4823';
  const locId = '4825cd19-a27c-4a68-8b33-6c1dac3596a4';

  console.log('\n--- 1. TransferRequests involving PLM ---');
  const tr = await pool.query(`
    SELECT transfer_type, count(*)
    FROM "TransferRequest"
    WHERE "fromLocationId" = $1 OR "toLocationId" = $1 OR "fromWarehouseId" = $2 OR "toWarehouseId" = $2
    GROUP BY transfer_type
  `, [locId, whId]);
  console.log('Transfer Request Types:', tr.rows);

  const trRemainingWh = await pool.query(`
    SELECT count(*)
    FROM "TransferRequest"
    WHERE "fromWarehouseId" = $1 OR "toWarehouseId" = $1
  `, [whId]);
  console.log('Transfer Requests still referencing PLM Warehouse ID:', trRemainingWh.rows[0].count);

  console.log('\n--- 2. Stock Ledgers for PLM Warehouse vs PLM Outlet ---');
  const slWh = await pool.query(`
    SELECT count(*), coalesce(sum(qty), 0) as net_qty
    FROM stock_ledgers
    WHERE warehouse_id = $1 AND location_id IS NULL
  `, [whId]);
  console.log('PLM Warehouse direct ledgers (location_id is null):', slWh.rows[0]);

  const slLoc = await pool.query(`
    SELECT count(*), coalesce(sum(qty), 0) as net_qty
    FROM stock_ledgers
    WHERE location_id = $1
  `, [locId]);
  console.log('PLM Outlet ledgers (location_id is PLM loc):', slLoc.rows[0]);

  console.log('\n--- 3. InventoryItem for PLM Warehouse vs PLM Outlet ---');
  const invWh = await pool.query(`
    SELECT count(*), coalesce(sum(quantity), 0) as net_qty
    FROM "InventoryItem"
    WHERE "warehouseId" = $1 AND "locationId" IS NULL
  `, [whId]);
  console.log('PLM Warehouse InventoryItems:', invWh.rows[0]);

  const invLoc = await pool.query(`
    SELECT count(*), coalesce(sum(quantity), 0) as net_qty
    FROM "InventoryItem"
    WHERE "locationId" = $1
  `, [locId]);
  console.log('PLM Outlet InventoryItems:', invLoc.rows[0]);

  console.log('\n--- 4. Monthly Stock Snapshots for PLM Warehouse vs PLM Outlet ---');
  const snapWh = await pool.query(`
    SELECT count(*), coalesce(sum(closing_qty), 0) as net_qty
    FROM monthly_stock_snapshots
    WHERE warehouse_id = $1 AND location_id IS NULL
  `, [whId]);
  console.log('PLM Warehouse Snapshots:', snapWh.rows[0]);

  const snapLoc = await pool.query(`
    SELECT count(*), coalesce(sum(closing_qty), 0) as net_qty
    FROM monthly_stock_snapshots
    WHERE location_id = $1
  `, [locId]);
  console.log('PLM Outlet Snapshots:', snapLoc.rows[0]);

  await pool.end();
}

main().catch(console.error);
