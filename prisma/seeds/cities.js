import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PAKISTAN_STATES = [
  { name: 'AZAD KASHMIR' },
  { name: 'BALOCHISTAN' },
  { name: 'FANA' },
  { name: 'FATA' },
  { name: 'KPK' },
  { name: 'PUNJAB' },
  { name: 'SINDH' },
];

function getStateByCoordinates(lat, lng, cityName) {
  const knownCities = {
    'Islamabad': 'FANA',
    'Karachi': 'SINDH',
    'Lahore': 'PUNJAB',
    'Faisalabad': 'PUNJAB',
    'Rawalpindi': 'PUNJAB',
    'Multan': 'PUNJAB',
    'Hyderabad': 'SINDH',
    'Gujranwala': 'PUNJAB',
    'Peshawar': 'KPK',
    'Quetta': 'BALOCHISTAN',
    'Sargodha': 'PUNJAB',
    'Sialkot': 'PUNJAB',
    'Bahawalpur': 'PUNJAB',
    'Sukkur': 'SINDH',
    'Larkana': 'SINDH',
    'Sheikhupura': 'PUNJAB',
    'Jhang': 'PUNJAB',
    'Rahim Yar Khan': 'PUNJAB',
    'Gujrat': 'PUNJAB',
    'Kasur': 'PUNJAB',
    'Mardan': 'KPK',
    'Sahiwal': 'PUNJAB',
    'Nawabshah': 'SINDH',
    'Chiniot': 'PUNJAB',
    'Kotri': 'SINDH',
    'Khanpur': 'PUNJAB',
    'Hafizabad': 'PUNJAB',
    'Kohat': 'KPK',
    'Jacobabad': 'SINDH',
    'Shikarpur': 'SINDH',
    'Muzaffargarh': 'PUNJAB',
    'Khanewal': 'PUNJAB',
    'Gojra': 'PUNJAB',
    'Mandi Bahauddin': 'PUNJAB',
    'Abbottabad': 'KPK',
    'Mirpur Khas': 'SINDH',
    'Chaman': 'BALOCHISTAN',
    'Sibi': 'BALOCHISTAN',
    'Turbat': 'BALOCHISTAN',
    'Gwadar': 'BALOCHISTAN',
    'Zhob': 'BALOCHISTAN',
    'Dera Ismail Khan': 'KPK',
    'Swat': 'KPK',
    'Mingora': 'KPK',
    'Bannu': 'KPK',
    'Mansehra': 'KPK',
    'Muzaffarabad': 'AZAD KASHMIR',
    'Mirpur': 'AZAD KASHMIR',
    'Rawalakot': 'AZAD KASHMIR',
    'Dera Ghazi Khan': 'PUNJAB',
  };

  if (knownCities[cityName]) {
    return knownCities[cityName];
  }
  if (!lat || !lng) {
    return 'PUNJAB';
  }
  if (lat >= 29 && lat <= 33 && lng >= 70 && lng <= 75) {
    if (lat >= 33.5 && lat <= 34 && lng >= 72.8 && lng <= 73.2) {
      return 'FANA';
    }
    if (lat >= 33.5 && lng < 72) {
      return 'KPK';
    }
    if (lat >= 33.5 && lng >= 73.5) {
      return 'AZAD KASHMIR';
    }
    return 'PUNJAB';
  }
  if (lat >= 24 && lat < 29 && lng >= 67 && lng <= 71) {
    return 'SINDH';
  }
  if (lat >= 31 && lat <= 36 && lng >= 70 && lng <= 74) {
    if (lat < 33.5 || (lat >= 33.5 && lng < 72)) {
      if (lat >= 33 && lat <= 35 && lng >= 70 && lng <= 71.5) {
        return 'FATA';
      }
      return 'KPK';
    }
    if (lat >= 33.5 && lng >= 73.5) {
      return 'AZAD KASHMIR';
    }
  }
  if (lat >= 25 && lat <= 32 && lng >= 60 && lng < 70) {
    return 'BALOCHISTAN';
  }
  if (lat >= 33 && lat <= 36 && lng >= 73 && lng <= 75) {
    return 'AZAD KASHMIR';
  }
  if (lat >= 33.5 && lat <= 34 && lng >= 72.8 && lng <= 73.2) {
    return 'FANA';
  }
  return 'PUNJAB';
}

export async function seedCities(prisma) {
  console.log('🏙️  Seeding states and cities for Pakistan...');
  const pakistan = await prisma.country.findFirst({ where: { phoneCode: 92 } });
  if (!pakistan) {
    console.error('⚠️  Pakistan not found. Please seed countries first.');
    return { statesCreated: 0, statesSkipped: 0, citiesCreated: 0, citiesSkipped: 0 };
  }
  console.log('📍 Seeding states...');
  const stateMap = new Map();
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
    } catch (error) {
      console.error(`Error seeding state "${stateData.name}":`, error.message);
    }
  }
  console.log(`✓ States: ${statesCreated} created, ${statesSkipped} skipped`);
  console.log('🏙️  Seeding cities...');
  const citiesPath = join(__dirname, '..', '..', 'city.json');
  const citiesData = JSON.parse(readFileSync(citiesPath, 'utf-8'));
  const pakistanCities = citiesData.filter(city => city.country === 'PK');
  let citiesCreated = 0;
  let citiesSkipped = 0;
  const defaultStateId = stateMap.get('PUNJAB');
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
    } catch (error) {
      console.error(`Error seeding city "${city.name}":`, error.message);
    }
  }
  console.log(`✓ Cities: ${citiesCreated} created, ${citiesSkipped} skipped (total: ${pakistanCities.length})`);
  return { statesCreated, statesSkipped, citiesCreated, citiesSkipped, totalCities: pakistanCities.length };
}
