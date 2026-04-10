import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

function decrypt(encryptedText: string, masterKeyString: string): string {
    if (!masterKeyString || masterKeyString.length < 32) {
        throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
    }
    const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
    const parts = encryptedText.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted text format');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

const KPI_TEMPLATES = [
    // ── Attendance ────────────────────────────────────────────────────────────
    {
        name: 'Attendance Rate',
        description: 'Percentage of working days the employee was present',
        category: 'attendance',
        metricType: 'auto',
        formula: 'attendance_rate',
        unit: '%',
        targetValue: 95,
        weight: 2,
    },
    {
        name: 'Punctuality Score',
        description: 'Percentage of present days the employee arrived on time',
        category: 'attendance',
        metricType: 'auto',
        formula: 'punctuality_score',
        unit: '%',
        targetValue: 90,
        weight: 1.5,
    },
    {
        name: 'Leave Utilization',
        description: 'Percentage of entitled leaves consumed in the period',
        category: 'attendance',
        metricType: 'auto',
        formula: 'leave_utilization',
        unit: '%',
        targetValue: 80,
        weight: 1,
    },

    // ── Productivity ──────────────────────────────────────────────────────────
    {
        name: 'Overtime Hours',
        description: 'Total approved overtime hours worked in the period',
        category: 'productivity',
        metricType: 'auto',
        formula: 'overtime_hours',
        unit: 'hrs',
        targetValue: 10,
        weight: 1,
    },
    {
        name: 'Task Completion Rate',
        description: 'Percentage of assigned tasks completed on time',
        category: 'productivity',
        metricType: 'manual',
        formula: null,
        unit: '%',
        targetValue: 90,
        weight: 2,
    },
    {
        name: 'Project Delivery Rate',
        description: 'Percentage of projects delivered on or before deadline',
        category: 'productivity',
        metricType: 'manual',
        formula: null,
        unit: '%',
        targetValue: 85,
        weight: 2,
    },

    // ── Performance ───────────────────────────────────────────────────────────
    {
        name: 'Goal Achievement Score',
        description: 'Percentage of quarterly goals achieved',
        category: 'performance',
        metricType: 'manual',
        formula: null,
        unit: '%',
        targetValue: 80,
        weight: 3,
    },
    {
        name: 'Manager Rating',
        description: 'Direct manager performance rating (0–100)',
        category: 'performance',
        metricType: 'manual',
        formula: null,
        unit: 'score',
        targetValue: 80,
        weight: 3,
    },
    {
        name: 'Peer Review Score',
        description: 'Average score from peer reviews (0–100)',
        category: 'performance',
        metricType: 'manual',
        formula: null,
        unit: 'score',
        targetValue: 75,
        weight: 1.5,
    },
    {
        name: 'Increment Percentage',
        description: 'Average salary increment percentage received in the period',
        category: 'performance',
        metricType: 'auto',
        formula: 'increment_percentage',
        unit: '%',
        targetValue: 10,
        weight: 1,
    },

    // ── Custom / Behavioural ──────────────────────────────────────────────────
    {
        name: 'Training Completion',
        description: 'Percentage of assigned training modules completed',
        category: 'custom',
        metricType: 'manual',
        formula: null,
        unit: '%',
        targetValue: 100,
        weight: 1,
    },
    {
        name: 'Customer Satisfaction Score',
        description: 'Average CSAT score from customer feedback (0–100)',
        category: 'custom',
        metricType: 'manual',
        formula: null,
        unit: 'score',
        targetValue: 85,
        weight: 2,
    },
    {
        name: 'Disciplinary Incidents',
        description: 'Number of disciplinary incidents (lower is better; target = 0)',
        category: 'custom',
        metricType: 'manual',
        formula: null,
        unit: 'count',
        targetValue: 0,
        weight: 1,
    },

    // ── Task Assessment ───────────────────────────────────────────────────────
    {
        name: 'Task Completion Rate',
        description: 'Percentage of assigned tasks completed on time (completedAt <= dueDate)',
        category: 'productivity',
        metricType: 'auto',
        formula: 'task_completion_rate',
        unit: '%',
        targetValue: 85,
        weight: 2,
    },
    {
        name: 'Task Quality Score',
        description: 'Average reviewer rating across completed tasks (1–5 scale → 0–100)',
        category: 'performance',
        metricType: 'auto',
        formula: 'task_quality_score',
        unit: 'score',
        targetValue: 80,
        weight: 2,
    },
    {
        name: 'Delivery Efficiency',
        description: 'Ratio of estimated vs actual hours (estimatedHours / actualHours × 100, capped at 100)',
        category: 'productivity',
        metricType: 'auto',
        formula: 'avg_task_completion_hours',
        unit: '%',
        targetValue: 100,
        weight: 1.5,
    },
];

async function seedKpiTemplates(tenantDbUrl: string, tenantName: string) {
    const pool = new Pool({ connectionString: tenantDbUrl });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter } as any);

    try {
        console.log(`\n===========================================`);
        console.log(`🌱 Seeding KPI Templates for: ${tenantName}`);
        console.log(`===========================================`);

        let created = 0;
        let skipped = 0;

        for (const tpl of KPI_TEMPLATES) {
            const existing = await (prisma as any).kpiTemplate.findFirst({
                where: { name: tpl.name },
            });

            if (existing) {
                console.log(`   ⏭️  Skipping (already exists): ${tpl.name}`);
                skipped++;
                continue;
            }

            await (prisma as any).kpiTemplate.create({
                data: {
                    name: tpl.name,
                    description: tpl.description,
                    category: tpl.category,
                    metricType: tpl.metricType,
                    formula: tpl.formula ?? null,
                    unit: tpl.unit,
                    targetValue: tpl.targetValue,
                    weight: tpl.weight,
                    status: 'active',
                },
            });

            console.log(`   ✅ Created: ${tpl.name}`);
            created++;
        }

        console.log(`\n📊 Done — ${created} created, ${skipped} skipped.`);
    } catch (error) {
        console.error(`❌ Error seeding KPI templates for ${tenantName}:`, error);
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

async function main() {
    const args = process.argv.slice(2);
    let targetTenant = '';

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--tenant' && args[i + 1]) {
            targetTenant = args[i + 1];
            i++;
        }
    }

    const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
    const masterKey = process.env.MASTER_ENCRYPTION_KEY;

    if (!managementUrl || !masterKey) {
        console.error('❌ DATABASE_URL_MANAGEMENT or MASTER_ENCRYPTION_KEY missing in .env');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const mClient = new ManagementClient({ adapter } as any);

    try {
        console.log('🔍 Connecting to Management Database...');

        const companyWhere = targetTenant ? { dbName: targetTenant } : { status: 'active' };
        const companies = await mClient.company.findMany({ where: companyWhere });

        if (companies.length === 0) {
            console.error('❌ No matching active companies found.');
            process.exit(1);
        }

        console.log(`📡 Found ${companies.length} company/companies. Starting seed...`);

        for (const company of companies) {
            let connectionString = `postgresql://${company.dbUser}:${company.dbPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;

            if (company.dbPassword) {
                try {
                    const decPassword = decrypt(company.dbPassword, masterKey);
                    const encUser = encodeURIComponent(company.dbUser || '');
                    const encPassword = encodeURIComponent(decPassword);
                    connectionString = `postgresql://${encUser}:${encPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
                } catch {
                    console.warn(`⚠️  Failed to decrypt password for ${company.name}, using stored value...`);
                }
            }

            await seedKpiTemplates(connectionString, company.name);
        }

        console.log('\n🎉 All tenants seeded successfully!');
    } catch (error: any) {
        console.error(`\n❌ Error: ${error.message}`);
    } finally {
        await mClient.$disconnect();
        await pool.end();
    }
}

main();
