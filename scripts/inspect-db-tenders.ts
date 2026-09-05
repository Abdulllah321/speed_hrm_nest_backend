import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

async function main() {
  const managementUrl = process.env.DATABASE_URL_MANAGEMENT!;
  const mgmtPool = new Pool({ connectionString: managementUrl });
  const compRes = await mgmtPool.query(`
    SELECT "dbUrl" FROM "Company" WHERE status = 'active' AND "dbName" = 'tenant_speed_main_mox1gfsi'
  `);
  await mgmtPool.end();

  const tenantConnStr = compRes.rows[0].dbUrl;
  const tenantPool = new Pool({ connectionString: tenantConnStr });
  const adapter = new PrismaPg(tenantPool);
  const prisma = new PrismaClient({ adapter });

  const locationId = "fa69f96c-dafe-49f5-91bb-a1ccd9e1bf4b";

  // Check sales_orders aggregations in DB
  const agg = await prisma.salesOrder.aggregate({
    where: { locationId },
    _sum: {
      subtotal: true,
      discountAmount: true,
      taxAmount: true,
      grandTotal: true,
      cashAmount: true,
      cardAmount: true,
      voucherAmount: true,
    },
    _count: true
  });

  console.log('DB Aggregates for SS1010 Sales Orders:', {
    count: agg._count,
    subtotal: agg._sum.subtotal?.toString(),
    discount: agg._sum.discountAmount?.toString(),
    tax: agg._sum.taxAmount?.toString(),
    grandTotal: agg._sum.grandTotal?.toString(),
    cashAmount: agg._sum.cashAmount?.toString(),
    cardAmount: agg._sum.cardAmount?.toString(),
    voucherAmount: agg._sum.voucherAmount?.toString(),
  });

  // Check payment_method breakdown
  const pmBreakdown = await prisma.salesOrder.groupBy({
    by: ['paymentMethod'],
    where: { locationId },
    _count: true,
    _sum: { grandTotal: true, cashAmount: true, cardAmount: true, voucherAmount: true }
  });
  console.log('Payment Method Breakdown in DB:', pmBreakdown);

  // Check how many orders have voucher redemptions
  const redemptions = await prisma.voucherRedemption.findMany({
    where: { order: { locationId } },
    include: { voucher: { select: { voucherType: true } } }
  });

  const redByType = new Map<string, number>();
  for (const r of redemptions) {
    const t = r.voucher?.voucherType || 'UNKNOWN';
    redByType.set(t, (redByType.get(t) || 0) + Number(r.amountUsed));
  }
  console.log('Voucher Redemptions by Type in DB:', Array.from(redByType.entries()));

  await prisma.$disconnect();
  await tenantPool.end();
}

main().catch(console.error);
