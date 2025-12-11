import { PrismaClient } from '@prisma/client';

export async function seedQualifications(prisma: PrismaClient) {
  console.log('🎓 Seeding qualifications...');
  const qualifications = [
    'BS Computer Science',
    'BS Software Engineering',
    'BS Information Technology',
    'BS Electrical Engineering',
    'BS Mechanical Engineering',
    'BS Civil Engineering',
    'BS Business Administration',
    'BS Accounting and Finance',
    'BS Economics',
    'MBA (Master of Business Administration)',
    'MS Computer Science',
    'MS Software Engineering',
    'MS Electrical Engineering',
    'MS Mechanical Engineering',
    'MS Civil Engineering',
    'MS Business Administration',
    'MS Economics',
    'MA English',
    'MA Urdu',
    'MA Psychology',
    'LLB (Bachelor of Laws)',
    'MBBS (Bachelor of Medicine, Bachelor of Surgery)',
    'BS Nursing',
    'BS Pharmacy',
    'Diploma in Computer Science',
    'Diploma in Information Technology',
    'Diploma in Business Administration',
    'F.A (Faculty of Arts)',
    'F.Sc (Faculty of Science)',
    'I.Com (Intermediate of Commerce)',
    'Matriculation',
  ];
  let created = 0;
  let skipped = 0;
  for (const name of qualifications) {
    try {
      const existing = await prisma.qualification.findFirst({ where: { name } });
      if (existing) { skipped++; continue; }
      await prisma.qualification.create({ data: { name, status: 'active' } });
      created++;
    } catch (error: any) {
      console.error(`Error seeding qualification "${name}":`, error.message);
    }
  }
  console.log(`✓ Qualifications: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}

