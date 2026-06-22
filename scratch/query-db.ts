import { PrismaService } from '../src/database/prisma.service';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { EncryptionService } from '../src/common/utils/encryption.service';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { EmployeeUploadProcessor } from '../src/queue/processors/employee-upload.processor';
import { MasterDataService } from '../src/common/services/master-data.service';

async function main() {
    process.env.DATABASE_URL_MANAGEMENT = 'postgresql://speedlimit:speedlimit123@localhost:5433/speedlimit_management';
    process.env.MASTER_ENCRYPTION_KEY = 'savdbia8s98ydgiqwns98s0a9djsa98hsu_master_key_encryption';

    // Connect to master database
    const poolMaster = new Pool({ connectionString: process.env.DATABASE_URL_MANAGEMENT });
    const adapterMaster = new PrismaPg(poolMaster);
    const masterPrisma = new ManagementClient({ adapter: adapterMaster as any });

    const companies = await masterPrisma.company.findMany({
        include: { tenant: true }
    });

    const company = companies[0];
    let dbUrl = company.dbUrl;
    if (company.dbPassword) {
        const encService = new EncryptionService();
        const plainPassword = encService.decrypt(company.dbPassword);
        const encodedPassword = encodeURIComponent(String(plainPassword));
        const port = company.dbPort || 5432;
        dbUrl = `postgresql://${encodeURIComponent(company.dbUser || '')}:${encodedPassword}@${company.dbHost}:${port}/${encodeURIComponent(company.dbName || '')}?schema=public&connection_limit=3&pool_timeout=15`;
    }
    
    console.log(`Connecting to tenant DB: ${company.dbName}...`);
    const prisma = new PrismaService({
        tenantId: company.tenant?.id || 'tenant',
        tenantDbUrl: dbUrl
    } as any);

    // Warm master data for simulation
    const tenantMasterData = new MasterDataService(prisma);
    await tenantMasterData.warmCache();

    // Instantiate a mockup of EmployeeUploadProcessor with minimal mocks
    const processor = new EmployeeUploadProcessor(null as any, null as any, null as any, null as any);

    // Let's find existing master data records
    const dept = await prisma.department.findFirst();
    const desig = await prisma.designation.findFirst();
    const grade = await prisma.employeeGrade.findFirst();
    const wh = await prisma.workingHoursPolicy.findFirst();
    const leaves = await prisma.leavesPolicy.findFirst();
    const country = await prisma.country.findFirst();
    const state = await prisma.state.findFirst();
    const city = await prisma.city.findFirst();

    if (!dept || !desig || !grade || !wh || !leaves || !country || !state || !city) {
        console.error('Error: Existing master data not found. Please seed master data first.');
        await prisma.$disconnect();
        await masterPrisma.$disconnect();
        await poolMaster.end();
        return;
    }

    console.log('Using master data:');
    console.log(`- Dept: ${dept.name} (${dept.id})`);
    console.log(`- Designation: ${desig.name} (${desig.id})`);
    console.log(`- Grade: ${grade.grade} (${grade.id})`);

    // Clean up any old test records
    await prisma.employee.deleteMany({
        where: {
            employeeId: { in: ['TEST_DEDUP_001', 'TEST_DEDUP_002', 'TEST_DEDUP_003', 'TEST_DEDUP_004'] }
        }
    });

    // Let's mock progress structure
    const progress: any = {
        totalRecords: 0,
        processedRecords: 0,
        successRecords: 0,
        failedRecords: 0,
        skippedRecords: 0,
        errors: [],
    };

    const seenImportCnics = new Map<string, string>();
    const seenImportEmails = new Map<string, string>();

    const record1 = {
        row: 1,
        data: {
            employeeId: 'TEST_DEDUP_001',
            employeeName: 'Employee 1',
            cnicNumber: '12345-1234567-1',
            officialEmail: 'dup-test@spl.com.pk',
            department: dept.name,
            designation: desig.name,
            employeeGrade: grade.grade,
            workingHoursPolicy: wh.name,
            leavesPolicy: leaves.name,
            country: country.name,
            state: state.name,
            city: city.name,
            joiningDate: new Date(),
            dateOfBirth: new Date('1990-01-01'),
            gender: 'Male',
            contactNumber: '0300-1111111'
        }
    };

    const record2 = {
        row: 2,
        data: {
            employeeId: 'TEST_DEDUP_002',
            employeeName: 'Employee 2',
            cnicNumber: '12345-1234567-2',
            officialEmail: 'dup-test@spl.com.pk', // duplicate email
            department: dept.name,
            designation: desig.name,
            employeeGrade: grade.grade,
            workingHoursPolicy: wh.name,
            leavesPolicy: leaves.name,
            country: country.name,
            state: state.name,
            city: city.name,
            joiningDate: new Date(),
            dateOfBirth: new Date('1990-01-01'),
            gender: 'Male',
            contactNumber: '0300-2222222'
        }
    };

    const record3 = {
        row: 3,
        data: {
            employeeId: 'TEST_DEDUP_003',
            employeeName: 'Employee 3',
            cnicNumber: '12345-1234567-1', // duplicate CNIC
            officialEmail: 'other@spl.com.pk',
            department: dept.name,
            designation: desig.name,
            employeeGrade: grade.grade,
            workingHoursPolicy: wh.name,
            leavesPolicy: leaves.name,
            country: country.name,
            state: state.name,
            city: city.name,
            joiningDate: new Date(),
            dateOfBirth: new Date('1990-01-01'),
            gender: 'Male',
            contactNumber: '0300-3333333'
        }
    };

    const record4 = {
        row: 4,
        data: {
            employeeId: 'TEST_DEDUP_001', // Update Record 1
            employeeName: 'Employee 1 Updated Name',
            cnicNumber: '12345-1234567-1',
            officialEmail: 'dup-test@spl.com.pk',
            department: dept.name,
            designation: desig.name,
            employeeGrade: grade.grade,
            workingHoursPolicy: wh.name,
            leavesPolicy: leaves.name,
            country: country.name,
            state: state.name,
            city: city.name,
            joiningDate: new Date(),
            dateOfBirth: new Date('1990-01-01'),
            gender: 'Male',
            contactNumber: '0300-1111111'
        }
    };

    console.log('\n--- Processing Record 1 ---');
    await (processor as any).processBatch([record1], progress, 'test-upload', prisma, tenantMasterData, seenImportCnics, seenImportEmails);

    console.log('\n--- Processing Record 2 (Duplicate Email) ---');
    await (processor as any).processBatch([record2], progress, 'test-upload', prisma, tenantMasterData, seenImportCnics, seenImportEmails);

    console.log('\n--- Processing Record 3 (Duplicate CNIC) ---');
    await (processor as any).processBatch([record3], progress, 'test-upload', prisma, tenantMasterData, seenImportCnics, seenImportEmails);

    console.log('\n--- Processing Record 4 (Update Employee 1) ---');
    await (processor as any).processBatch([record4], progress, 'test-upload', prisma, tenantMasterData, seenImportCnics, seenImportEmails);

    console.log('\n--- Final Progress ---');
    console.log(JSON.stringify(progress, null, 2));

    // Verify records in DB
    const emps = await prisma.employee.findMany({
        where: {
            employeeId: { in: ['TEST_DEDUP_001', 'TEST_DEDUP_002', 'TEST_DEDUP_003'] }
        },
        select: { employeeId: true, employeeName: true, cnicNumber: true, officialEmail: true }
    });
    console.log('\n--- Employees in DB ---');
    console.log(JSON.stringify(emps, null, 2));

    // Clean up
    await prisma.employee.deleteMany({
        where: {
            employeeId: { in: ['TEST_DEDUP_001', 'TEST_DEDUP_002', 'TEST_DEDUP_003', 'TEST_DEDUP_004'] }
        }
    });

    await prisma.$disconnect();
    await masterPrisma.$disconnect();
    await poolMaster.end();
}

main().catch(console.error);
