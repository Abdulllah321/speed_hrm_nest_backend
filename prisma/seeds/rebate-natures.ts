import { PrismaClient } from '@prisma/client';

export async function seedRebateNatures(prisma: PrismaClient, createdById: string) {
  console.log('💰 Seeding rebate natures...');
  const natures = [
    {
      name: 'Charitable / Zakaat Donation us 61',
      maxInvestmentPercentage: 30,
      maxInvestmentAmount: 2000000,
      isAgeDependent: false,
    },
    {
      name: 'Investment of Shares and Insurance us 62',
      maxInvestmentPercentage: 20,
      maxInvestmentAmount: 2000000,
      isAgeDependent: false,
    },
    {
      name: 'Bank Investment',
      maxInvestmentPercentage: 20,
      maxInvestmentAmount: 2000000,
      isAgeDependent: false,
    },
    {
      name: 'Health Insurance us 62A',
      maxInvestmentPercentage: 5,
      maxInvestmentAmount: 150000,
      isAgeDependent: false,
    },
    {
      name: 'Pension us 63',
      maxInvestmentPercentage: 20, // Default, but overridden by logic
      maxInvestmentAmount: null, // Logic determines cap typically, but here we set null if dynamic
      isAgeDependent: true,
    },
  ];

  let created = 0;
  let skipped = 0;

  for (const nature of natures) {
    try {
      const existing = await prisma.rebateNature.findFirst({ // findFirst instead of findUnique to avoid TS errors if name isn't unique in schema yet
        where: { name: nature.name },
      });
      if (existing) {
        skipped++;
        continue;
      }

      await prisma.rebateNature.create({
        data: {
          name: nature.name,
          maxInvestmentPercentage: nature.maxInvestmentPercentage,
          maxInvestmentAmount: nature.maxInvestmentAmount,
          isAgeDependent: nature.isAgeDependent,
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
