import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi' });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function check() {
  const locs = await prisma.location.findMany({
    select: { id: true, code: true, shortCode: true, name: true }
  });
  console.log('Locations:');
  for (const l of locs) {
    console.log(`[${l.id}] code: "${l.code}", shortCode: "${l.shortCode}", name: "${l.name}"`);
  }
  await pool.end();
}
check();
