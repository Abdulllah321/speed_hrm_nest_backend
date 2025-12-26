import { PrismaClient } from '@prisma/client';

export async function seedRebateNatures(prisma: PrismaClient, createdById: string) {
  console.log('💰 Seeding rebate natures...');
  
  // Other type rebate natures (existing ones)
  const otherNatures = [
    {
      name: 'Charitable / Zakaat Donation us 61',
      type: 'other',
      maxInvestmentPercentage: 30,
      maxInvestmentAmount: 2000000,
      isAgeDependent: false,
    },
    {
      name: 'Investment of Shares and Insurance us 62',
      type: 'other',
      maxInvestmentPercentage: 20,
      maxInvestmentAmount: 2000000,
      isAgeDependent: false,
    },
    {
      name: 'Bank Investment',
      type: 'other',
      maxInvestmentPercentage: 20,
      maxInvestmentAmount: 2000000,
      isAgeDependent: false,
    },
    {
      name: 'Health Insurance us 62A',
      type: 'other',
      maxInvestmentPercentage: 5,
      maxInvestmentAmount: 150000,
      isAgeDependent: false,
    },
    {
      name: 'Pension us 63',
      type: 'other',
      maxInvestmentPercentage: 20, // Default, but overridden by logic
      maxInvestmentAmount: null, // Logic determines cap typically, but here we set null if dynamic
      isAgeDependent: true,
    },
  ];

  // Fixed type rebate natures
  const fixedNatures = [
    // Education
    {
      name: 'Educational Tax us 60B',
      type: 'fixed',
      category: 'Education',
    },
    // Consumer
    {
      name: 'Domestic Consumer Tax us 235A',
      type: 'fixed',
      category: 'Consumer',
    },
    // Banking
    {
      name: 'Cash Withdrawal us 231A',
      type: 'fixed',
      category: 'Banking',
    },
    {
      name: 'Certain Bank Transaction us 231A',
      type: 'fixed',
      category: 'Banking',
    },
    {
      name: 'Banking Transaction Other Than Cash us 236P',
      type: 'fixed',
      category: 'Banking',
    },
    // Vehicle
    {
      name: 'Transfer of Vehicle us 231B',
      type: 'fixed',
      category: 'Vehicle',
    },
    {
      name: 'Private Vehicle Token us 234',
      type: 'fixed',
      category: 'Vehicle',
    },
    {
      name: 'Vehicle Registration us 231B(1)',
      type: 'fixed',
      category: 'Vehicle',
    },
    {
      name: 'Sale of Vehicle us 231B(3)',
      type: 'fixed',
      category: 'Vehicle',
    },
    // Telephone
    {
      name: 'Cell Phone us 236(1)(a)',
      type: 'fixed',
      category: 'Telephone',
    },
    {
      name: 'Telephone us 236(1)(a)',
      type: 'fixed',
      category: 'Telephone',
    },
    {
      name: 'Prepaid us 236(1)(b)',
      type: 'fixed',
      category: 'Telephone',
    },
    {
      name: 'Phone Unit us 236(1)(c)',
      type: 'fixed',
      category: 'Telephone',
    },
    {
      name: 'Internet us 236(1)(d)',
      type: 'fixed',
      category: 'Telephone',
    },
    // Property
    {
      name: 'Purchase and Sale of Property us 236C',
      type: 'fixed',
      category: 'Property',
    },
    {
      name: 'Transfer of Property us 236K',
      type: 'fixed',
      category: 'Property',
    },
    {
      name: 'Registration us 236W',
      type: 'fixed',
      category: 'Property',
    },
  ];

  let created = 0;
  let skipped = 0;

  // Process other natures
  for (const nature of otherNatures) {
    try {
      const existing = await prisma.rebateNature.findFirst({
        where: { name: nature.name },
      });
      if (existing) {
        // Update existing to include type if missing
        if (!existing.type) {
          await prisma.rebateNature.update({
            where: { id: existing.id },
            data: {
              type: nature.type,
            },
          });
        }
        skipped++;
        continue;
      }

      await prisma.rebateNature.create({
        data: {
          name: nature.name,
          type: nature.type,
          category: null,
          maxInvestmentPercentage: nature.maxInvestmentPercentage || null,
          maxInvestmentAmount: nature.maxInvestmentAmount || null,
          isAgeDependent: nature.isAgeDependent || false,
          status: 'active',
          createdById,
        },
      });
      created++;
    } catch (error: any) {
      console.error(`Error seeding rebate nature "${nature.name}":`, error.message);
    }
  }

  // Process fixed natures
  for (const nature of fixedNatures) {
    try {
      const existing = await prisma.rebateNature.findFirst({
        where: { name: nature.name },
      });
      if (existing) {
        // Update existing to include type and category if missing
        if (!existing.type || (nature.type === 'fixed' && !existing.category)) {
          await prisma.rebateNature.update({
            where: { id: existing.id },
            data: {
              type: nature.type,
              category: nature.category || null,
            },
          });
        }
        skipped++;
        continue;
      }

      await prisma.rebateNature.create({
        data: {
          name: nature.name,
          type: nature.type,
          category: nature.category || null,
          maxInvestmentPercentage: null,
          maxInvestmentAmount: null,
          isAgeDependent: false,
          status: 'active',
          createdById,
        },
      });
      created++;
    } catch (error: any) {
      console.error(`Error seeding rebate nature "${nature.name}":`, error.message);
    }
  }
  console.log(`✓ Rebate Natures: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}
