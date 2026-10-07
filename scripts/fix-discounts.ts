import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const targetLocation = process.argv[2]; // Passed as an argument (e.g. "WATCH OUTLET-SAFA GOLD MALL")
  
  if (!targetLocation) {
    console.log('Starting historical discount fix script for ALL locations...');
  } else {
    console.log(`Starting historical discount fix script for location: ${targetLocation}`);
  }
  
  // Find orders created between 01-10-2026 and 07-10-2026 (inclusive)
  const startDate = new Date('2026-10-01T00:00:00Z');
  const endDate = new Date('2026-10-07T23:59:59Z');

  let locationIds: string[] = [];
  if (targetLocation) {
    const locations = await prisma.location.findMany({
      where: {
        name: { contains: targetLocation, mode: 'insensitive' }
      },
      select: { id: true }
    });
    locationIds = locations.map(l => l.id);
    if (locationIds.length === 0) {
      console.log(`No locations found matching: ${targetLocation}`);
      return;
    }
  }

  const whereClause: Prisma.SalesOrderWhereInput = {
    createdAt: { 
      gte: startDate,
      lte: endDate
    },
    OR: [
      { globalDiscountAmount: { gt: 0 } },
      { allianceId: { not: null } }
    ]
  };

  if (locationIds.length > 0) {
    whereClause.locationId = { in: locationIds };
  }

  const orders = await prisma.salesOrder.findMany({
    where: whereClause,
    include: {
      items: {
        include: {
          item: true
        }
      },
      alliance: true
    }
  });

  console.log(`Found ${orders.length} orders to potentially fix.`);

  // Pre-fetch locations to get FBR settings
  const allLocationIds = [...new Set(orders.map(o => o.locationId).filter(id => id !== null))] as string[];
  const locationsData = await prisma.location.findMany({
    where: { id: { in: allLocationIds } }
  });
  const locationMap = new Map(locationsData.map(l => [l.id, l]));

  let updatedCount = 0;

  for (const order of orders) {
    try {
      const subtotal = Number(order.subtotal);
      
      let recalculatedTotalTax = 0;
      let lineItemDiscountTotal = 0;

      for (const oi of order.items) {
        const qty = Number(oi.quantity);
        const taxPercent = Number(oi.taxPercent ?? 0);
        const unitPrice = Number(oi.unitPrice);
        const discountPercent = Number(oi.overrideDiscountPercent ?? oi.discountPercent ?? 0);
        
        const taxDivisor = 1 + (taxPercent / 100);
        const wostPerUnit = unitPrice / taxDivisor;
        const totalWost = wostPerUnit * qty;
        
        const itemDiscount = totalWost * (discountPercent / 100);
        lineItemDiscountTotal += itemDiscount;
        
        const afterItemDiscount = totalWost - itemDiscount;
        const itemTax = afterItemDiscount * (taxPercent / 100);
        
        recalculatedTotalTax += itemTax;
      }
      
      const loc = order.locationId ? locationMap.get(order.locationId) : null;
      const fbrPosFee = (loc?.fbrEnabled && loc?.fbrNtn) ? 1 : 0;
      
      const grandTotalBeforeManual = Math.round((subtotal - lineItemDiscountTotal + recalculatedTotalTax + fbrPosFee) * 100) / 100;

      let manualDiscount = 0;
      let allianceDiscount = 0;
      let globalDiscAmt = 0;

      // 1. Manual Discount Logic
      const rawGlobalDiscountAmount = Number(order.globalDiscountAmount ?? 0);
      if (order.globalDiscountPercent && Number(order.globalDiscountPercent) > 0) {
        // Percentage manual discount (NO SCALING)
        const cappedPercent = Math.min(Number(order.globalDiscountPercent), 100);
        manualDiscount = Math.round(subtotal * (cappedPercent / 100) * 100) / 100;
      } else if (rawGlobalDiscountAmount > 0 && order.manualDiscountNote) {
        // Flat amount manual discount (SCALING NEEDED)
        const maxFlatDiscount = Math.round(grandTotalBeforeManual * 1.0 * 100) / 100;
        const targetDiscountOnGrandTotal = Math.min(rawGlobalDiscountAmount, maxFlatDiscount);
        if (grandTotalBeforeManual > 0) {
          manualDiscount = Math.round(targetDiscountOnGrandTotal * (subtotal / grandTotalBeforeManual) * 100) / 100;
        }
      }

      // 2. Alliance Discount Logic
      if (order.alliance) {
        const targetDiscountOnWST = Math.round(grandTotalBeforeManual * (Number(order.alliance.discountPercent) / 100) * 100) / 100;
        let cappedTarget = targetDiscountOnWST;
        if (order.alliance.maxDiscount) {
          cappedTarget = Math.min(targetDiscountOnWST, Number(order.alliance.maxDiscount));
        }
        if (grandTotalBeforeManual > 0) {
          allianceDiscount = Math.round(cappedTarget * (subtotal / grandTotalBeforeManual) * 100) / 100;
        }
      }

      // Priority Resolution
      let finalLineItemDiscount = lineItemDiscountTotal;
      if (manualDiscount > 0) {
        globalDiscAmt = manualDiscount;
        finalLineItemDiscount = 0;
      } else if (lineItemDiscountTotal > 0 && allianceDiscount > 0) {
        if (allianceDiscount >= lineItemDiscountTotal) {
          globalDiscAmt = allianceDiscount;
          finalLineItemDiscount = 0;
        } else {
          globalDiscAmt = 0;
          finalLineItemDiscount = lineItemDiscountTotal;
        }
      } else if (allianceDiscount > 0) {
        globalDiscAmt = allianceDiscount;
      }

      const currentDbGlobalDiscountAmount = Number(order.globalDiscountAmount ?? 0);
      
      let newTotalTax = 0;
      
      if (globalDiscAmt > 0) {
        const baseSubtotal = subtotal > 0 ? subtotal : 1;
        let distributedDisc = 0;
        
        const itemWosts = order.items.map(item => {
          const taxDivisor = 1 + Number(item.taxPercent ?? 0) / 100;
          return (Number(item.unitPrice) / taxDivisor) * Number(item.quantity);
        });

        const rawShares = itemWosts.map(itemWost => {
          const share = Math.floor((globalDiscAmt * itemWost) / baseSubtotal);
          distributedDisc += share;
          return share;
        });

        const remainder = Math.round(globalDiscAmt - distributedDisc);
        const sortedIdx = itemWosts
          .map((v, i) => ({ i, v }))
          .sort((a, b) => b.v - a.v)
          .map(x => x.i);

        for (let k = 0; k < remainder; k++) {
          rawShares[sortedIdx[k % sortedIdx.length]]++;
        }

        order.items.forEach((item, idx) => {
          const itemWost = itemWosts[idx];
          const share = rawShares[idx];
          const afterDiscount = itemWost - share;
          newTotalTax += Math.round(afterDiscount * (Number(item.taxPercent ?? 0) / 100) * 100) / 100;
        });
      } else {
        newTotalTax = recalculatedTotalTax; // Just the item level taxes
      }
      
      const currentTax = Number(order.taxAmount);
      const currentGrandTotal = Number(order.grandTotal);
      
      const newGrandTotal = Math.round(Math.max(0, subtotal - globalDiscAmt - finalLineItemDiscount + newTotalTax + fbrPosFee));
      
      if (Math.abs(currentGrandTotal - newGrandTotal) > 0.01 || Math.abs(currentTax - newTotalTax) > 0.01 || Math.abs(currentDbGlobalDiscountAmount - globalDiscAmt) > 0.01) {
        console.log(`Fixing Order ${order.orderNumber}:`);
        console.log(`  Discount: ${currentDbGlobalDiscountAmount} -> ${globalDiscAmt}`);
        console.log(`  Tax: ${currentTax} -> ${newTotalTax}`);
        console.log(`  GrandTotal: ${currentGrandTotal} -> ${newGrandTotal}`);
        
        await prisma.salesOrder.update({
          where: { id: order.id },
          data: {
            globalDiscountAmount: globalDiscAmt,
            taxAmount: newTotalTax,
            grandTotal: newGrandTotal
          }
        });
        
        updatedCount++;
      }
    } catch (err) {
      console.error(`Error fixing order ${order.orderNumber}:`, err);
    }
  }

  console.log(`Finished. Successfully updated ${updatedCount} orders.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
