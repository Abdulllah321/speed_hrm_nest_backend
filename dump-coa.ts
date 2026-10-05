import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const accounts = await prisma.chartOfAccount.findMany({
    select: { code: true, name: true, type: true }
  });
  console.log(JSON.stringify(accounts, null, 2));
}

main().catch(console.error).finally(() => {
  prisma.$disconnect();
  pool.end();
});
