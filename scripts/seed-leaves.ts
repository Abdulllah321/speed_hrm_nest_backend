import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

// ─── Data ─────────────────────────────────────────────────────────────────────

export const leaveTypesSeed: string[] = [
  'Annual Leave',
  'Sick Leave',
  'Casual Leave',
  'Emergency Leave',
  'Maternity Leave',
  'Paternity Leave',
  'Compensatory Leave',
  'Unpaid Leave',
  'Half Day Leave',
  'Short Leave',
  'Privilege Leave',
];

export interface LeavePolicySeed {
  id?: string;
  name: string;
  details: string;
  fullDayDeductionRate: number;
  halfDayDeductionRate: number;
  shortLeaveDeductionRate: number;
  isDefault: boolean;
  leaveTypes: { name: string; numberOfLeaves: number }[];
}

export const leavesPoliciesSeed: LeavePolicySeed[] = [
  {
    name: 'Standard Leave Policy',
    details: 'Standard leave policy for all employees',
    fullDayDeductionRate: 1.0,
    halfDayDeductionRate: 0.5,
    shortLeaveDeductionRate: 0.25,
    isDefault: true,
    leaveTypes: [
      { name: 'Annual Leave', numberOfLeaves: 14 },
      { name: 'Sick Leave', numberOfLeaves: 10 },
      { name: 'Casual Leave', numberOfLeaves: 5 },
      { name: 'Emergency Leave', numberOfLeaves: 3 },
    ],
  },
  {
    name: 'Executive Leave Policy',
    details: 'Enhanced leave policy for executives',
    fullDayDeductionRate: 1.0,
    halfDayDeductionRate: 0.5,
    shortLeaveDeductionRate: 0.25,
    isDefault: false,
    leaveTypes: [
      { name: 'Annual Leave', numberOfLeaves: 20 },
      { name: 'Sick Leave', numberOfLeaves: 15 },
      { name: 'Casual Leave', numberOfLeaves: 7 },
      { name: 'Emergency Leave', numberOfLeaves: 5 },
      { name: 'Compensatory Leave', numberOfLeaves: 5 },
    ],
  },
  {
    name: 'Probation Leave Policy',
    details: 'Limited leave policy for probationary employees',
    fullDayDeductionRate: 1.0,
    halfDayDeductionRate: 0.5,
    shortLeaveDeductionRate: 0.25,
    isDefault: false,
    leaveTypes: [
      { name: 'Sick Leave', numberOfLeaves: 5 },
      { name: 'Emergency Leave', numberOfLeaves: 2 },
    ],
  },
  {
    id: '9d080e70-d566-4d16-a819-5396a1ca1f5a',
    name: 'Speed Sport Leave Policy',
    details: 'Leave policy with casual, sick, and privilege leaves',
    fullDayDeductionRate: 1.0,
    halfDayDeductionRate: 0.5,
    shortLeaveDeductionRate: 0.25,
    isDefault: false,
    leaveTypes: [
      { name: 'Casual Leave', numberOfLeaves: 5 },
      { name: 'Sick Leave', numberOfLeaves: 10 },
      { name: 'Privilege Leave', numberOfLeaves: 15 },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!masterKeyString || masterKeyString.length < 32) {
    throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
  }
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const parts = encryptedText.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted text format');

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(parts[2], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ─── Seed functions ───────────────────────────────────────────────────────────

async function seedLeaveTypes(
  prisma: PrismaClient,
  createdById: string,
): Promise<Map<string, string>> {
  console.log('   📋 Seeding leave types...');
  let created = 0;
  let skipped = 0;
  const leaveTypeMap = new Map<string, string>();

  for (const name of leaveTypesSeed) {
    try {
      const existing = await prisma.leaveType.findFirst({ where: { name } });
      if (existing) {
        skipped++;
        leaveTypeMap.set(name, existing.id);
        continue;
      }
      const leaveType = await prisma.leaveType.create({
        data: { name, status: 'active', createdById },
      });
      leaveTypeMap.set(name, leaveType.id);
      created++;
    } catch (error: any) {
      console.error(`   Error seeding leave type "${name}":`, error.message);
    }
  }

  console.log(`   ✓ Leave Types: ${created} created, ${skipped} skipped`);
  return leaveTypeMap;
}

async function seedLeavesPolicies(
  prisma: PrismaClient,
  createdById: string,
): Promise<void> {
  console.log('   📜 Seeding leaves policies...');

  const leaveTypeMap = await seedLeaveTypes(prisma, createdById);

  let created = 0;
  let skipped = 0;

  for (const policy of leavesPoliciesSeed) {
    try {
      const existing = await prisma.leavesPolicy.findFirst({
        where: { name: policy.name },
      });
      if (existing) {
        skipped++;
        continue;
      }

      const leavesPolicy = await prisma.leavesPolicy.create({
        data: {
          ...(policy.id ? { id: policy.id } : {}),
          name: policy.name,
          details: policy.details,
          fullDayDeductionRate: policy.fullDayDeductionRate,
          halfDayDeductionRate: policy.halfDayDeductionRate,
          shortLeaveDeductionRate: policy.shortLeaveDeductionRate,
          status: 'active',
          isDefault: policy.isDefault,
          createdById,
        },
      });

      for (const lt of policy.leaveTypes) {
        const leaveTypeId = leaveTypeMap.get(lt.name);
        if (leaveTypeId) {
          await prisma.leavesPolicyLeaveType.create({
            data: {
              leavesPolicyId: leavesPolicy.id,
              leaveTypeId,
              numberOfLeaves: lt.numberOfLeaves,
            },
          });
        }
      }

      created++;
    } catch (error: any) {
      console.error(
        `   Error seeding leaves policy "${policy.name}":`,
        error.message,
      );
    }
  }

  console.log(`   ✓ Leaves Policies: ${created} created, ${skipped} skipped`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Starting Multi-Tenant Leave Types & Policies Seeding...');

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (!managementUrl) {
    console.error('❌ DATABASE_URL_MANAGEMENT not found in .env');
    process.exit(1);
  }

  if (!masterKey) {
    console.error('❌ MASTER_ENCRYPTION_KEY not found in .env');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: managementUrl });
  const adapter = new PrismaPg(pool);
  const management = new ManagementClient({ adapter } as any);

  try {
    const tenantArgIdx = process.argv.indexOf('--tenant');
    const specificTenant =
      tenantArgIdx !== -1 ? process.argv[tenantArgIdx + 1] : null;

    const companies = await management.company.findMany({
      where: {
        status: 'active',
        ...(specificTenant ? { dbName: specificTenant } : {}),
      },
    });

    if (companies.length === 0) {
      console.log(
        specificTenant
          ? `ℹ️  No active company found with database name: ${specificTenant}`
          : 'ℹ️  No active companies found in Master DB.',
      );
      return;
    }

    console.log(
      specificTenant
        ? `📡 Targeting tenant: ${specificTenant}. Seeding leave data...`
        : `📡 Found ${companies.length} active companies. Seeding leave data...`,
    );

    for (const company of companies) {
      console.log(`\n👉 Processing tenant: ${company.name} (${company.code})`);

      try {
        let connectionString = company.dbUrl;

        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(
              decrypt(company.dbPassword, masterKey),
            );
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch {
            console.warn(
              `   ⚠️  Decryption failed for ${company.code}, using stored dbUrl...`,
            );
          }
        }

        if (!connectionString) {
          console.error(`   ❌ No connection details for ${company.code}`);
          continue;
        }

        const tenantPool = new Pool({ connectionString });
        const tenantAdapter = new PrismaPg(tenantPool);
        const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

        try {
          await tenantPrisma.$connect();

          // Use a placeholder createdById — tenant schema may not have a User model
          const createdById = 'system';

          await seedLeavesPolicies(tenantPrisma, createdById);

          console.log(`   ✅ Success!`);
        } finally {
          await tenantPrisma.$disconnect();
          await tenantPool.end();
        }
      } catch (err: any) {
        console.error(`   ❌ Failed to seed ${company.code}: ${err.message}`);
      }
    }

    console.log('\n✨ All tenants processed.');
  } catch (error: any) {
    console.error(`\n❌ Error querying Master DB: ${error.message}`);
  } finally {
    await management.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
