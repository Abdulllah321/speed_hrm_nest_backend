
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {  PERMISSIONS } from './src/config/permissions';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function updatePermissions() {
  console.log('Starting permission update...');

  try {
    // 1. Get all existing permissions from the database
    const existingPermissions = await prisma.permission.findMany();
    const existingPermissionNames = new Set(existingPermissions.map((p) => p.name));
    const newPermissionNames = new Set(PERMISSIONS.map((p) => p.name));

    // 2. Identify permissions to delete (exist in DB but not in new list)
    const permissionsToDelete = existingPermissions.filter(
      (p) => !newPermissionNames.has(p.name)
    );

    // 3. Identify permissions to create (exist in new list but not in DB)
    const permissionsToCreate = PERMISSIONS.filter(
      (p) => !existingPermissionNames.has(p.name)
    );

    // 4. Identify permissions to update (exist in both)
    const permissionsToUpdate = PERMISSIONS.filter(
      (p) => existingPermissionNames.has(p.name)
    );

    console.log(`Found ${existingPermissions.length} existing permissions.`);
    console.log(`Found ${PERMISSIONS.length} new permissions in configuration.`);
    console.log(`To Delete: ${permissionsToDelete.length}`);
    console.log(`To Create: ${permissionsToCreate.length}`);
    console.log(`To Update: ${permissionsToUpdate.length}`);

    // Execute Deletions
    if (permissionsToDelete.length > 0) {
      console.log('Deleting old permissions...');
      const deleteResult = await prisma.permission.deleteMany({
        where: {
          name: {
            in: permissionsToDelete.map((p) => p.name),
          },
        },
      });
      console.log(`Deleted ${deleteResult.count} permissions.`);
    }

    // Execute Creations
    if (permissionsToCreate.length > 0) {
      console.log('Creating new permissions...');
      const createResult = await prisma.permission.createMany({
        data: permissionsToCreate.map((p) => ({
          name: p.name,
          module: p.module,
          action: p.action,
          description: p.description,
        })),
      });
      console.log(`Created ${createResult.count} permissions.`);
    }

    // Execute Updates
    if (permissionsToUpdate.length > 0) {
      console.log('Updating existing permissions...');
      // createMany doesn't support update, and updateMany doesn't support different values per row.
      // We have to loop or use a transaction. Loop is safer for reasonable amounts.
      let updatedCount = 0;
      for (const p of permissionsToUpdate) {
        await prisma.permission.update({
          where: { name: p.name },
          data: {
            module: p.module,
            action: p.action,
            description: p.description,
          },
        });
        updatedCount++;
      }
      console.log(`Updated ${updatedCount} permissions.`);
    }

    console.log('Permission update completed successfully.');
  } catch (error) {
    console.error('Error updating permissions:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

updatePermissions();
