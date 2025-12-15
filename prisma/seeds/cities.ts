import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';

const PAKISTAN_STATES = [
  { name: 'Azad Kashmir' },
  { name: 'Balochistan' },
  { name: 'Fana' },
  { name: 'Fata' },
  { name: 'Khyber Pakhtunkhwa' },
  { name: 'Punjab' },
  { name: 'Sindh' },
];

function getStateByCoordinates(lat: number | undefined, lng: number | undefined, cityName: string): string {
  const knownCities: Record<string, string> = {
    'Islamabad': 'Fana',
    'Karachi': 'Sindh',
    'Lahore': 'Punjab',
    'Faisalabad': 'Punjab',
    'Rawalpindi': 'Punjab',
    'Multan': 'Punjab',
    'Hyderabad': 'Sindh',
    'Gujranwala': 'Punjab',
    'Peshawar': 'Khyber Pakhtunkhwa',
    'Quetta': 'Balochistan',
    'Sargodha': 'Punjab',
    'Sialkot': 'Punjab',
    'Bahawalpur': 'Punjab',
    'Sukkur': 'Sindh',
    'Larkana': 'Sindh',
    'Sheikhupura': 'Punjab',
    'Jhang': 'Punjab',
    'Rahim Yar Khan': 'Punjab',
    'Gujrat': 'Punjab',
    'Kasur': 'Punjab',
    'Mardan': 'Khyber Pakhtunkhwa',
    'Sahiwal': 'Punjab',
    'Nawabshah': 'Sindh',
    'Chiniot': 'Punjab',
    'Kotri': 'Sindh',
    'Khanpur': 'Punjab',
    'Hafizabad': 'Punjab',
    'Kohat': 'Khyber Pakhtunkhwa',
    'Jacobabad': 'Sindh',
    'Shikarpur': 'Sindh',
    'Muzaffargarh': 'Punjab',
    'Khanewal': 'Punjab',
    'Gojra': 'Punjab',
    'Mandi Bahauddin': 'Punjab',
    'Abbottabad': 'Khyber Pakhtunkhwa',
    'Mirpur Khas': 'Sindh',
    'Chaman': 'Balochistan',
    'Sibi': 'Balochistan',
    'Turbat': 'Balochistan',
    'Gwadar': 'Balochistan',
    'Zhob': 'Balochistan',
    'Dera Ismail Khan': 'Khyber Pakhtunkhwa',
    'Swat': 'Khyber Pakhtunkhwa',
    'Mingora': 'Khyber Pakhtunkhwa',
    'Bannu': 'Khyber Pakhtunkhwa',
    'Mansehra': 'Khyber Pakhtunkhwa',
    'Muzaffarabad': 'Azad Kashmir',
    'Mirpur': 'Azad Kashmir',
    'Rawalakot': 'Azad Kashmir',
    'Dera Ghazi Khan': 'Punjab',
  };

  if (knownCities[cityName]) {
    return knownCities[cityName];
  }
  if (!lat || !lng) {
    return 'Punjab';
  }
  if (lat >= 29 && lat <= 33 && lng >= 70 && lng <= 75) {
    if (lat >= 33.5 && lat <= 34 && lng >= 72.8 && lng <= 73.2) {
      return 'Fana';
    }
    if (lat >= 33.5 && lng < 72) {
      return 'Khyber Pakhtunkhwa';
    }
    if (lat >= 33.5 && lng >= 73.5) {
      return 'Azad Kashmir';
    }
    return 'Punjab';
  }
  if (lat >= 24 && lat < 29 && lng >= 67 && lng <= 71) {
    return 'Sindh';
  }
  if (lat >= 31 && lat <= 36 && lng >= 70 && lng <= 74) {
    if (lat < 33.5 || (lat >= 33.5 && lng < 72)) {
      if (lat >= 33 && lat <= 35 && lng >= 70 && lng <= 71.5) {
        return 'Fata';
      }
      return 'Khyber Pakhtunkhwa';
    }
    if (lat >= 33.5 && lng >= 73.5) {
      return 'Azad Kashmir';
    }
  }
  if (lat >= 25 && lat <= 32 && lng >= 60 && lng < 70) {
    return 'Balochistan';
  }
  if (lat >= 33 && lat <= 36 && lng >= 73 && lng <= 75) {
    return 'Azad Kashmir';
  }
  if (lat >= 33.5 && lat <= 34 && lng >= 72.8 && lng <= 73.2) {
    return 'Fana';
  }
  return 'Punjab';
}

export async function seedCities(prisma: PrismaClient) {
  console.log('🏙️  Seeding states and cities for Pakistan...');
  const pakistan = await prisma.country.findFirst({ where: { phoneCode: 92 } });
  if (!pakistan) {
    console.error('⚠️  Pakistan not found. Please seed countries first.');
    return { statesCreated: 0, statesSkipped: 0, citiesCreated: 0, citiesSkipped: 0 };
  }
  console.log('📍 Seeding states...');
  const stateMap = new Map<string, string>();
  let statesCreated = 0;
  let statesSkipped = 0;
  for (const stateData of PAKISTAN_STATES) {
    try {
      const existing = await prisma.state.findFirst({ where: { name: stateData.name, countryId: pakistan.id } });
      if (existing) {
        stateMap.set(stateData.name, existing.id);
        statesSkipped++;
        continue;
      }
      const state = await prisma.state.create({ data: { name: stateData.name, countryId: pakistan.id, status: 'active' } });
      stateMap.set(stateData.name, state.id);
      statesCreated++;
    } catch (error: any) {
      console.error(`Error seeding state "${stateData.name}":`, error.message);
    }
  }
  console.log(`✓ States: ${statesCreated} created, ${statesSkipped} skipped`);
  console.log('🏙️  Seeding cities...');
  const citiesPath = join(process.cwd(), 'city.json');
  const citiesData = JSON.parse(readFileSync(citiesPath, 'utf-8')) as Array<{
    name?: string;
    country?: string;
    lat?: number;
    lng?: number;
  }>;
  const pakistanCities = citiesData.filter(city => city.country === 'PK');
  let citiesCreated = 0;
  let citiesSkipped = 0;
  const defaultStateId = stateMap.get('Punjab');
  for (const city of pakistanCities) {
    try {
      const cityName = city.name?.trim();
      if (!cityName) continue;
      const stateName = getStateByCoordinates(city.lat, city.lng, cityName);
      const stateId = stateMap.get(stateName) || defaultStateId;
      if (!stateId) {
        console.warn(`⚠️  State "${stateName}" not found for city "${cityName}", skipping`);
        continue;
      }
      const existing = await prisma.city.findFirst({ where: { name: cityName, countryId: pakistan.id, stateId } });
      if (existing) {
        citiesSkipped++;
        continue;
      }
      await prisma.city.create({ data: { name: cityName, countryId: pakistan.id, stateId, status: 'active' } });
      citiesCreated++;
    } catch (error: any) {
      console.error(`Error seeding city "${city.name}":`, error.message);
    }
  }
  console.log(`✓ Cities: ${citiesCreated} created, ${citiesSkipped} skipped (total: ${pakistanCities.length})`);
  return { statesCreated, statesSkipped, citiesCreated, citiesSkipped, totalCities: pakistanCities.length };
}

