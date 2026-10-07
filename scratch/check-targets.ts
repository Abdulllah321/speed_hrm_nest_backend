import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const dbUrl = 'postgresql://speedlimit:speedlimit123@localhost:5433/tenant_speed_main_mox1gfsi?schema=public';
const pool = new Pool({ connectionString: dbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter: adapter as any });

async function main() {
  const codes = ['12070004', '40010013', '40010005', '40010006', '40010002', '40010003', '31070001'];
  const coas = await prisma.chartOfAccount.findMany({
    where: {
      code: { in: codes }
    },
    select: {
      id: true,
      code: true,
      name: true,
      parentId: true,
    }
  });
  console.log('--- TARGET COAs ---');
  for (const c of coas) {
    const children = await prisma.chartOfAccount.findMany({
      where: { parentId: c.id }
    });
    console.log(`[${c.code}] ${c.name} (id: ${c.id}) -> Children count: ${children.length}`);
    for (const ch of children) {
      console.log(`     Child: [${ch.code}] ${ch.name} (id: ${ch.id})`);
    }
  }
}

main().catch(console.error).finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
