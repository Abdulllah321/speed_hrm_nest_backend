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

  try {
    console.log('🔄 Fixing TransferRequest transfer_type for PLM...');
    
    // Get PLM Location
    const locRes = await pool.query(`SELECT id FROM "Location" WHERE code = 'C20001'`);
    if (locRes.rowCount === 0) {
      console.log('❌ PLM Location C20001 not found');
      return;
    }
    const locId = locRes.rows[0].id;

    // Update OUTLET_TO_WAREHOUSE to OUTLET_TO_OUTLET (when going to PLM)
    const updateIn = await pool.query(`
      UPDATE "TransferRequest"
      SET transfer_type = 'OUTLET_TO_OUTLET'
      WHERE "toLocationId" = $1 AND transfer_type = 'OUTLET_TO_WAREHOUSE'
    `, [locId]);
    console.log(`✅ Updated ${updateIn.rowCount} OUTLET_TO_WAREHOUSE transfers to OUTLET_TO_OUTLET.`);

    // Update WAREHOUSE_TO_OUTLET to OUTLET_TO_OUTLET (when coming from PLM)
    const updateOut = await pool.query(`
      UPDATE "TransferRequest"
      SET transfer_type = 'OUTLET_TO_OUTLET'
      WHERE "fromLocationId" = $1 AND transfer_type = 'WAREHOUSE_TO_OUTLET'
    `, [locId]);
    console.log(`✅ Updated ${updateOut.rowCount} WAREHOUSE_TO_OUTLET transfers to OUTLET_TO_OUTLET.`);

  } catch (error) {
    console.error('Error fixing transfer types:', error);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
