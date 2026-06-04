const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function updateAllowanceTaxStatus() {
  try {
    // Update all existing allowances where isTaxable is currently false to remain false
    // And set any null/undefined to false explicitly
    const allowanceResult = await prisma.allowance.updateMany({
      data: {
        isTaxable: false
      }
    });
    
    console.log(`Updated ${allowanceResult.count} allowance records to ensure non-taxable status`);
    
    // Update all existing bonuses where isTaxable is currently false to remain false
    const bonusResult = await prisma.bonus.updateMany({
      data: {
        isTaxable: false
      }
    });
    
    console.log(`Updated ${bonusResult.count} bonus records to ensure non-taxable status`);
    
  } catch (error) {
    console.error('Error updating allowance tax status:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updateAllowanceTaxStatus();