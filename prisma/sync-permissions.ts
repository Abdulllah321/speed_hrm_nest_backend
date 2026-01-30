/**
 * Standalone script to sync master permissions
 * Run with: npx ts-node prisma/sync-permissions.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { syncMasterPermissions } from './seeds/sync-master-permissions';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('🔄 Master Permissions Sync Script');
  console.log('═══════════════════════════════════════════');
  console.log('');

  await syncMasterPermissions(prisma);

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('✅ Done! Please re-login to get updated permissions.');
  console.log('═══════════════════════════════════════════');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
