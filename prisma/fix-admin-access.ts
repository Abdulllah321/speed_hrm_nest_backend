
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🔍 Finding Admin role...');
    const adminRole = await prisma.role.findFirst({
        where: {
            OR: [
                { name: 'admin' },
                { name: 'Admin' },
                { isSystem: true, name: 'admin' }
            ]
        }
    });

    if (!adminRole) {
        console.error('❌ Admin role not found!');
        return;
    }
    console.log(`✅ Found Admin Role: ${adminRole.name} (${adminRole.id})`);

    console.log('🔍 Fetching all permissions...');
    const allPermissions = await prisma.permission.findMany();
    console.log(`✅ Found ${allPermissions.length} total permissions.`);

    if (allPermissions.length === 0) {
        console.warn('⚠️ No permissions found in database. Seeding might be needed.');
        return;
    }

    console.log('🔄 Updating Admin role with ALL permissions...');

    // Update role: remove old permissions and add all new ones
    await prisma.role.update({
        where: { id: adminRole.id },
        data: {
            permissions: {
                deleteMany: {}, // Remove existing associations
                create: allPermissions.map(p => ({
                    permission: { connect: { id: p.id } }
                }))
            }
        }
    });

    console.log('✨ Success! Admin role now has full access.');
}

main()
    .catch(e => {
        console.error('❌ Error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
