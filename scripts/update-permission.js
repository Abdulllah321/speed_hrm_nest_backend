"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../.env') });
const management_client_1 = require("@prisma/management-client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const permissions_1 = require("../src/config/permissions");
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL_MANAGEMENT });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new management_client_1.PrismaClient({ adapter });
async function updatePermissions() {
    console.log('Starting permission update...');
    try {
        const existingPermissions = await prisma.permission.findMany();
        const existingPermissionNames = new Set(existingPermissions.map((p) => p.name));
        const newPermissionNames = new Set(permissions_1.PERMISSIONS.map((p) => p.name));
        const permissionsToDelete = existingPermissions.filter((p) => !newPermissionNames.has(p.name));
        const permissionsToCreate = permissions_1.PERMISSIONS.filter((p) => !existingPermissionNames.has(p.name));
        const permissionsToUpdate = permissions_1.PERMISSIONS.filter((p) => existingPermissionNames.has(p.name));
        console.log(`Found ${existingPermissions.length} existing permissions.`);
        console.log(`Found ${permissions_1.PERMISSIONS.length} new permissions in configuration.`);
        console.log(`To Delete: ${permissionsToDelete.length}`);
        console.log(`To Create: ${permissionsToCreate.length}`);
        console.log(`To Update: ${permissionsToUpdate.length}`);
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
        if (permissionsToCreate.length > 0) {
            console.log('Creating new permissions...');
            const createResult = await prisma.permission.createMany({
                data: permissionsToCreate.map((p) => {
                    let { name, description } = p;
                    let module = p.module;
                    let action = p.action;
                    if (!module || !action) {
                        const parts = name.split('.');
                        if (parts.length >= 2) {
                            action = parts.pop();
                            module = parts.join('.');
                        }
                        else {
                            action = 'manage';
                            module = name;
                        }
                    }
                    return {
                        name,
                        module: module,
                        action: action,
                        description,
                    };
                }),
            });
            console.log(`Created ${createResult.count} permissions.`);
        }
        if (permissionsToUpdate.length > 0) {
            console.log('Updating existing permissions...');
            let updatedCount = 0;
            for (const p of permissionsToUpdate) {
                let { name, description } = p;
                let module = p.module;
                let action = p.action;
                if (!module || !action) {
                    const parts = name.split('.');
                    if (parts.length >= 2) {
                        action = parts.pop();
                        module = parts.join('.');
                    }
                    else {
                        action = 'manage';
                        module = name;
                    }
                }
                await prisma.permission.update({
                    where: { name: p.name },
                    data: {
                        module: module,
                        action: action,
                        description,
                    },
                });
                updatedCount++;
            }
            console.log(`Updated ${updatedCount} permissions.`);
        }
        console.log('Permission update completed successfully.');
    }
    catch (error) {
        console.error('Error updating permissions:', error);
        process.exit(1);
    }
    finally {
        await prisma.$disconnect();
    }
}
updatePermissions();
//# sourceMappingURL=update-permission.js.map