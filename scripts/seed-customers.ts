import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Your existing customer data
const customerData = [
  {
    code: '310001',
    name: 'ZAHID ASSOCIATES',
    address: 'OFFICE NO 4, 109-WEST, SARDAR BEGUM PLAZA, BLUE AREA, Islamabad Urban',
    contactNo: '03005527662'
  },
  {
    code: '310003',
    name: 'NIZAM WATCH HOUSE',
    address: '43-A BANK ROAD, SADDAR, RAWALPINDI',
    contactNo: '051-5563912'
  },
  {
    code: '310004',
    name: 'NIZAM WATCH HOUSE 2 ISB',
    address: 'SHOP NO 10, GROUND FLOOR, BLOCK 13-J, F7 JINNAH SUPER, ISLAMABAD',
    contactNo: '051-2655130'
  },
  {
    code: '310005',
    name: 'NIZAM & COMPANY',
    address: '414-A/7, 1st Floor, Bank Road, Saddar, Cantonment, RAWALPINDI',
    contactNo: '051-5563912'
  },
  {
    code: '310006',
    name: 'INTERNATIONAL WATCH CO',
    address: 'SHOP NO 5, LAKSHMI CHOWK, GROUND FLOOR M.A.JINNAH ROAD',
    contactNo: '021-32443918'
  },
  {
    code: '310007',
    name: 'GMT DISTRIBUTORS',
    address: 'M 4 MAJEED PLAZA BANK ROAD, SADDAR, RAWALPINDI',
    contactNo: '0333-5102897'
  }
];

async function seedCustomers() {
  console.log('🌱 Seeding customers...');
  
  try {
    for (const customer of customerData) {
      const existingCustomer = await prisma.customer.findUnique({
        where: { code: customer.code }
      });
      
      if (!existingCustomer) {
        await prisma.customer.create({
          data: {
            ...customer,
            balance: 0
          }
        });
        console.log(`✅ Created customer: ${customer.name} (${customer.code})`);
      } else {
        console.log(`⚠️  Customer already exists: ${customer.name} (${customer.code})`);
      }
    }
    
    console.log('🎉 Customer seeding completed!');
  } catch (error) {
    console.error('❌ Error seeding customers:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seeder
if (require.main === module) {
  seedCustomers();
}

export { seedCustomers };