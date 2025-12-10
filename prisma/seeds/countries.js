import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function seedCountries(prisma) {
  console.log('🌍 Seeding countries...');
  const countriesPath = join(__dirname, '..', '..', 'countries.json');
  const countriesData = JSON.parse(readFileSync(countriesPath, 'utf-8'));
  let created = 0;
  let updated = 0;
  for (const item of countriesData) {
    const countryName = item.name?.trim();
    const countryIso = item.iso?.trim();
    if (!countryName || !countryIso) continue;
    const phoneCode = item.phonecode ? parseInt(item.phonecode, 10) : null;
    const numcode = item.numcode ? parseInt(item.numcode, 10) : null;
    if (phoneCode === null || isNaN(phoneCode) || numcode === null || isNaN(numcode)) {
      console.warn(`⚠️  Skipping ${countryName}: invalid phoneCode or numcode`);
      continue;
    }
    const existing = await prisma.country.findFirst({ where: { iso: countryIso } });
    if (existing) {
      await prisma.country.update({
        where: { id: existing.id },
        data: {
          name: countryName,
          iso: countryIso,
          nicename: item.nicename?.trim() || countryName,
          iso3: item.iso3?.trim() || '',
          phoneCode: phoneCode,
          numcode: numcode,
        },
      });
      updated++;
    } else {
      await prisma.country.create({
        data: {
          name: countryName,
          iso: countryIso,
          nicename: item.nicename?.trim() || countryName,
          iso3: item.iso3?.trim() || '',
          phoneCode: phoneCode,
          numcode: numcode,
        },
      });
      created++;
    }
  }
  console.log(`✓ ${created} countries created, ${updated} countries updated (total: ${countriesData.length})`);
  return { created, updated, total: countriesData.length };
}
