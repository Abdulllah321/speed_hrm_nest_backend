import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DATABASE_URL || 'postgresql://postgres:root@localhost:5432/spl_core_db?schema=public'
        }
    }
});

async function main() {
  console.log('Generating Monthly Snapshots for September 30 (October 1 00:00:00)...');
  
  const targetDateStr = '2026-10-01T00:00:00.000Z';
  const cutoffDateStr = '2026-10-01T00:00:00.000Z';
  
  await prisma.$executeRawUnsafe(`
      INSERT INTO monthly_stock_snapshots (id, date, item_id, warehouse_id, location_id, closing_qty, unit_cost)
      SELECT 
        gen_random_uuid(),
        '${targetDateStr}'::timestamp,
        s.item_id, 
        s.warehouse_id, 
        s.location_id, 
        SUM(s.qty),
        COALESCE(
            (SELECT COALESCE(unit_cost, rate) FROM stock_ledgers l2 
             WHERE l2.item_id = s.item_id 
             AND l2.created_at <= '${cutoffDateStr}'::timestamp 
             AND (l2.unit_cost > 0 OR l2.rate > 0)
             ORDER BY l2.created_at DESC LIMIT 1), 
             0
        ) as unit_cost
      FROM stock_ledgers s
      WHERE s.created_at <= '${cutoffDateStr}'::timestamp
      GROUP BY s.item_id, s.warehouse_id, s.location_id
      HAVING SUM(s.qty) != 0
  `);
  
  console.log('Done!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
