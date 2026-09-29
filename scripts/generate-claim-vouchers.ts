import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';

function cleanLocCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function parseExcelSerialDate(val: string | number): Date {
  const num = typeof val === 'number' ? val : parseFloat(String(val));
  if (isNaN(num) || num <= 0) return new Date();
  // Excel epoch is 1899-12-30
  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  return new Date(excelEpoch.getTime() + num * 86400000);
}

async function main() {
  const connectionString =
    process.argv.find((a) => a.startsWith('--db='))?.split('=')[1] ||
    'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi';
  console.log(`🔌 Connecting to database (${connectionString})...`);
  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const filePath = path.join(__dirname, '../data/claim-register.md');
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  console.log(`📖 Reading claim register from ${filePath}...`);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content
    .split('\n')
    .filter(
      (l) =>
        l.trim().startsWith('|') &&
        !l.includes('---') &&
        !l.includes('CostCentre'),
    );

  const rows = lines.map((line, idx) => {
    const parts = line.split('|').map((s) => s.trim());
    return {
      rowIdx: idx + 1,
      costCentre: parts[1],
      locId: parts[2],
      docDateRaw: parts[3],
      docNo: parts[4],
      saleDocNo: parts[5],
      saleDocDateRaw: parts[6],
      redeemDocNo: parts[7] || '',
      redeemDocDateRaw: parts[8] || '',
      amount: parseFloat(parts[9]) || 0,
      customerName: parts[10] && parts[10] !== '-' ? parts[10] : '',
      customerMobile: parts[11] && parts[11] !== '-' ? parts[11] : '',
      customerEmail: parts[12] && parts[12] !== '-' ? parts[12] : '',
      customerAddress: parts[13] && parts[13] !== '-' ? parts[13] : '',
      remarks: parts[14],
      settlementRemarks: parts[15],
    };
  });

  console.log(`📦 Loaded ${rows.length} claim rows from claim-register.md`);

  const locations = await prisma.location.findMany({
    select: { id: true, code: true, shortCode: true, name: true },
  });
  const locMap = new Map<string, typeof locations[0]>();
  for (const l of locations) {
    if (l.code) locMap.set(l.code.toUpperCase(), l);
    if (l.shortCode) locMap.set(cleanLocCode(l.shortCode), l);
  }

  // Pre-load all sales orders for matching redemptions
  console.log(`🔍 Pre-loading sales orders for redemption matching...`);
  const allSalesOrders = await prisma.salesOrder.findMany({
    select: {
      id: true,
      orderNumber: true,
      locationId: true,
      grandTotal: true,
      voucherAmount: true,
      notes: true,
      createdAt: true,
    },
  });
  console.log(`   Found ${allSalesOrders.length} sales orders in DB.`);

  // 1. Find existing CLAIM vouchers and the 2 leopard REFUND vouchers
  console.log(`\n🧹 Finding existing claim vouchers to replace/clean...`);
  const existingClaimVouchers = await prisma.voucher.findMany({
    where: {
      OR: [
        { voucherType: 'CLAIM' },
        { code: { in: ['REF-SSONLINE27-00521', 'REF-SSONLINE27-00522'] } },
      ],
    },
    select: { id: true, code: true },
  });
  const oldVoucherIds = existingClaimVouchers.map((v) => v.id);
  console.log(`   Found ${oldVoucherIds.length} existing claim/refund vouchers.`);

  if (oldVoucherIds.length > 0) {
    console.log(`   Unlinking pos_returns foreign keys...`);
    await prisma.posReturn.updateMany({
      where: { voucherId: { in: oldVoucherIds } },
      data: { voucherId: null },
    });

    console.log(`   Deleting old voucher redemptions...`);
    await prisma.voucherRedemption.deleteMany({
      where: { voucherId: { in: oldVoucherIds } },
    });

    console.log(`   Deleting old voucher transactions...`);
    await prisma.voucherTransaction.deleteMany({
      where: { voucherId: { in: oldVoucherIds } },
    });

    console.log(`   Deleting old voucher locations...`);
    await prisma.voucherLocation.deleteMany({
      where: { voucherId: { in: oldVoucherIds } },
    });

    console.log(`   Deleting old vouchers...`);
    await prisma.voucher.deleteMany({
      where: { id: { in: oldVoucherIds } },
    });
    console.log(`   ✅ Cleaned up old vouchers successfully.`);
  }

  // Fetch all PosReturns to re-link to new vouchers where applicable
  const allPosReturns = await prisma.posReturn.findMany({
    select: {
      id: true,
      returnNumber: true,
      locationId: true,
      reason: true,
    },
  });

  // 2. Process all 200 rows and generate vouchers
  console.log(`\n🚀 Generating ${rows.length} Claim Vouchers directly from claim-register.md...`);

  let createdVoucherCount = 0;
  let redeemedCount = 0;
  let unredeemedCount = 0;
  let totalFaceValue = 0;
  let totalRedeemedAmount = 0;
  let linkedPosReturns = 0;

  for (const r of rows) {
    const loc = locMap.get(r.locId.toUpperCase());
    if (!loc) {
      throw new Error(`Location not found for code: ${r.locId} (Row #${r.rowIdx})`);
    }

    const cleanShort = loc.shortCode ? cleanLocCode(loc.shortCode) : cleanLocCode(loc.code);
    const padDoc = String(r.docNo).padStart(5, '0');
    const voucherCode = `CLM-${cleanShort}27-${padDoc}`;

    const docDate = parseExcelSerialDate(r.docDateRaw);
    const isRedeemed = Boolean(r.redeemDocNo && r.redeemDocNo.trim() !== '' && r.redeemDocNo !== '0');

    // Find or create customer
    let customerId: string | null = null;
    const cleanPhone = r.customerMobile ? r.customerMobile.replace(/[^0-9]/g, '') : '';
    if (cleanPhone.length >= 7 || r.customerName) {
      let cust = null;
      if (cleanPhone.length >= 7) {
        cust = await prisma.customer.findFirst({
          where: { contactNo: { contains: cleanPhone.slice(-7) } },
        });
      }
      if (!cust && r.customerName && r.customerName.trim() !== '') {
        cust = await prisma.customer.findFirst({
          where: { name: { equals: r.customerName.trim(), mode: 'insensitive' } },
        });
      }
      if (!cust && r.customerName && r.customerName.trim() !== '') {
        cust = await prisma.customer.create({
          data: {
            name: r.customerName.trim(),
            contactNo: r.customerMobile || null,
            email: r.customerEmail || null,
            address: r.customerAddress || null,
            customerType: 'POS',
          },
        });
      }
      if (cust) {
        customerId = cust.id;
      }
    }

    const description = `CLAIM Voucher for Doc #${r.docNo} (Sale #${r.saleDocNo || 'N/A'})${
      r.remarks ? ` - ${r.remarks}` : ''
    }${r.settlementRemarks ? ` [${r.settlementRemarks}]` : ''}`;

    // Create the Voucher
    const voucher = await prisma.voucher.create({
      data: {
        code: voucherCode,
        voucherType: 'CLAIM',
        faceValue: r.amount,
        description,
        customerId,
        issuedByLocationId: loc.id,
        isRedeemed,
        isActive: true,
        createdAt: docDate,
        updatedAt: docDate,
      },
    });

    // Create VoucherLocation for this store
    await prisma.voucherLocation.create({
      data: {
        voucherId: voucher.id,
        locationId: loc.id,
      },
    });

    // Audit log: ISSUED transaction
    await prisma.voucherTransaction.create({
      data: {
        voucherId: voucher.id,
        locationId: loc.id,
        action: 'ISSUED',
        amountUsed: r.amount,
        notes: `Issued for Claim Doc #${r.docNo} at ${loc.name}`,
        createdAt: docDate,
      },
    });

    // Link posReturn if matching
    const matchingReturn = allPosReturns.find((ret) => {
      if (ret.locationId !== loc.id) return false;
      const pad5 = padDoc;
      return (
        ret.returnNumber.endsWith(`-${pad5}`) ||
        ret.returnNumber === voucherCode ||
        (r.saleDocNo && r.saleDocNo !== '0' && ret.reason?.includes(r.saleDocNo))
      );
    });
    if (matchingReturn) {
      await prisma.posReturn.update({
        where: { id: matchingReturn.id },
        data: { voucherId: voucher.id },
      });
      linkedPosReturns++;
    }

    totalFaceValue += r.amount;
    createdVoucherCount++;

    // Process Redemption if present
    if (isRedeemed) {
      const padRedeem = String(r.redeemDocNo).padStart(5, '0');
      const redeemDate = parseExcelSerialDate(r.redeemDocDateRaw);

      // Match target SalesOrder in the issuance store directly
      let targetOrder = allSalesOrders.find((o) => {
        const isLoc = o.locationId === loc.id;
        if (!isLoc) return false;
        return (
          o.orderNumber.endsWith(`-${padRedeem}`) ||
          o.orderNumber.endsWith(`-${r.redeemDocNo}`) ||
          o.notes?.includes(`Sale #${r.redeemDocNo}`) ||
          o.notes?.includes(`DocNo: ${r.redeemDocNo}`) ||
          o.notes?.includes(`Doc #${r.redeemDocNo}`)
        );
      });

      // Fallback cross-location if needed
      if (!targetOrder) {
        targetOrder = allSalesOrders.find(
          (o) =>
            o.orderNumber.endsWith(`-${padRedeem}`) ||
            o.notes?.includes(`DocNo: ${r.redeemDocNo}`) ||
            o.notes?.includes(`Doc #${r.redeemDocNo}`),
        );
      }

      if (targetOrder) {
        // Create redemption record
        await prisma.voucherRedemption.create({
          data: {
            voucherId: voucher.id,
            orderId: targetOrder.id,
            amountUsed: r.amount,
            createdAt: redeemDate,
          },
        });

        // Audit log: REDEEMED transaction
        await prisma.voucherTransaction.create({
          data: {
            voucherId: voucher.id,
            orderId: targetOrder.id,
            locationId: targetOrder.locationId,
            action: 'REDEEMED',
            amountUsed: r.amount,
            notes: `Redeemed against Invoice #${r.redeemDocNo} (${targetOrder.orderNumber})`,
            createdAt: redeemDate,
          },
        });

        redeemedCount++;
        totalRedeemedAmount += r.amount;
      } else {
        console.warn(
          `⚠️ Target sales order not found for redemption: Store ${loc.code} docNo ${r.docNo} redeemDocNo ${r.redeemDocNo}`,
        );
      }
    } else {
      unredeemedCount++;
    }
  }

  console.log(`\n========================================================================================`);
  console.log(`📊 [CLAIM VOUCHER GENERATION & REDEMPTION SUMMARY]`);
  console.log(`========================================================================================`);
  console.log(`1. TOTAL VOUCHERS GENERATED : ${createdVoucherCount}`);
  console.log(`2. TOTAL FACE VALUE (PKR)   : PKR ${totalFaceValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`3. REDEEMED VOUCHERS        : ${redeemedCount} (PKR ${totalRedeemedAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`);
  console.log(`4. ACTIVE / OPEN VOUCHERS   : ${unredeemedCount} (PKR ${(totalFaceValue - totalRedeemedAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`);
  console.log(`5. LINKED POS RETURNS       : ${linkedPosReturns}`);
  console.log(`========================================================================================\n`);

  // Final verification from DB
  const finalClaimsCount = await prisma.voucher.count({
    where: { voucherType: 'CLAIM' },
  });
  const finalRedeemedCount = await prisma.voucher.count({
    where: { voucherType: 'CLAIM', isRedeemed: true },
  });
  const finalOpenCount = await prisma.voucher.count({
    where: { voucherType: 'CLAIM', isRedeemed: false, isActive: true },
  });
  const finalRedemptionsCount = await prisma.voucherRedemption.count({
    where: { voucher: { voucherType: 'CLAIM' } },
  });

  console.log(`Verification from DB:`);
  console.log(`- Total CLAIM Vouchers in DB: ${finalClaimsCount}`);
  console.log(`- Redeemed CLAIM Vouchers in DB: ${finalRedeemedCount}`);
  console.log(`- Open/Active CLAIM Vouchers in DB: ${finalOpenCount}`);
  console.log(`- VoucherRedemptions in DB: ${finalRedemptionsCount}`);

  await pool.end();
}

main().catch((err) => {
  console.error('Fatal error generating claim vouchers:', err);
  process.exit(1);
});
