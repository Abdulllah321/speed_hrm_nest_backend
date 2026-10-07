import { PrismaClient } from '@prisma/client';

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

  const whereClause: any = {
    createdAt: { 
      gte: startDate,
      lte: endDate
    },
    isDeleted: false,
    OR: [
      { globalDiscountAmount: { gt: 0 } },
      { allianceId: { not: null } }
    ]
  };

  if (targetLocation) {
    whereClause.location = {
      name: {
        contains: targetLocation,
        mode: 'insensitive'
      }
    };
  }

  const orders = await prisma.salesOrder.findMany({
    where: whereClause,
    include: {
      items: {
        include: {
          item: true
        }
      },
      alliance: true,
      location: true
    }
  });

  console.log(`Found ${orders.length} orders to potentially fix.`);

  let updatedCount = 0;

  for (const order of orders) {
    try {
      let needsUpdate = false;
      
      const subtotal = Number(order.subtotal);
      let grandTotalBeforeManual = 0;
      
      let recalculatedTotalTax = 0;
      let lineItemDiscountTotal = 0;

      // Re-calculate the grand total before any global discounts to use as scaling base
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
      
      const fbrPosFee = Number(order.fbrPosFee ?? 0);
      grandTotalBeforeManual = Math.round((subtotal - lineItemDiscountTotal + recalculatedTotalTax) * 100) / 100;

      let manualDiscount = 0;
      let allianceDiscount = 0;
      let globalDiscAmt = 0;
      let appliedDiscountType = 'item';

      // 1. Manual Discount Logic
      const rawGlobalDiscountAmount = Number(order.globalDiscountAmount ?? 0);
      if (order.globalDiscountPercent && Number(order.globalDiscountPercent) > 0) {
        // Percentage manual discount (NO SCALING)
        const cappedPercent = Math.min(Number(order.globalDiscountPercent), 100);
        manualDiscount = Math.round(subtotal * (cappedPercent / 100) * 100) / 100;
      } else if (rawGlobalDiscountAmount > 0 && order.manualDiscountNote) {
        // Flat amount manual discount (SCALING NEEDED)
        // Note: we check manualDiscountNote to distinguish true manual discount vs populated amount
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
        appliedDiscountType = 'manual';
      } else if (lineItemDiscountTotal > 0 && allianceDiscount > 0) {
        if (allianceDiscount >= lineItemDiscountTotal) {
          globalDiscAmt = allianceDiscount;
          finalLineItemDiscount = 0;
          appliedDiscountType = 'alliance';
        } else {
          globalDiscAmt = 0;
          finalLineItemDiscount = lineItemDiscountTotal;
          appliedDiscountType = 'item';
        }
      } else if (allianceDiscount > 0) {
        globalDiscAmt = allianceDiscount;
        appliedDiscountType = 'alliance';
      }

      // Check if the newly calculated global discount amount matches the one in DB
      const currentDbGlobalDiscountAmount = Number(order.globalDiscountAmount ?? 0);
      
      // Calculate what the tax and grand total SHOULD be with the new global discount
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
      
      // Also account for coupon/promo if they exist (we assume they didn't change logic, keeping it simple)
      const currentTax = Number(order.taxAmount);
      const currentGrandTotal = Number(order.grandTotal);
      
      const newGrandTotal = Math.round(Math.max(0, subtotal - globalDiscAmt - finalLineItemDiscount + newTotalTax) + fbrPosFee);
      
      // If there's a difference in Grand Total or Tax or Discount
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
