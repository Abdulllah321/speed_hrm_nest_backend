import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi' });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function check() {
  const vouchers = await prisma.voucher.findMany({
    where: { OR: [{ voucherType: 'CLAIM' }, { code: { in: ['REF-SSONLINE27-00521', 'REF-SSONLINE27-00522'] } }] },
    include: {
      posReturn: {
        select: {
          id: true,
          returnNumber: true,
          reason: true,
          locationId: true,
          totalRefundAmount: true,
          salesOrder: {
            select: {
              id: true,
              orderNumber: true,
              notes: true
            }
          }
        }
      }
    }
  });

  console.log('Total vouchers:', vouchers.length);
  const withoutReturn = vouchers.filter(v => !v.posReturn);
  console.log('Without posReturn:', withoutReturn.length);

  const sample = vouchers.slice(0, 10).map(v => ({
    code: v.code,
    voucherType: v.voucherType,
    faceValue: Number(v.faceValue),
    returnNumber: v.posReturn?.returnNumber,
    reason: v.posReturn?.reason,
    saleOrder: v.posReturn?.salesOrder?.orderNumber
  }));
  console.log('Sample 10 vouchers:', sample);

  await pool.end();
}
check();
