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
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL_MANAGEMENT });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new management_client_1.PrismaClient({ adapter });
const ROLES = [
    {
        name: 'super-admin',
        description: 'Complete rights across all modules. Assigned to Faheem Akhter & Junaid Rasheed.',
        isSystem: true,
    },
    {
        name: 'pos-monitoring',
        description: 'POS full access + ERP read/monitoring. Excludes Finance and HRM. Assigned to Anwarullah Ansari & Rehan.',
        isSystem: false,
    },
    {
        name: 'local-purchase',
        description: 'Local Purchase & Landed Cost (Procurement module). Assigned to Numair Arshad.',
        isSystem: false,
    },
    {
        name: 'pos-inventory-move',
        description: 'POS access + inventory movement (transfers, receiving, returns). Assigned to Nasir Jamal.',
        isSystem: false,
    },
    {
        name: 'pos-inventory-mgmt',
        description: 'POS access + full inventory management. Assigned to Hasan Tanveer & Sheheryar.',
        isSystem: false,
    },
    {
        name: 'pos-only',
        description: 'POS module only. Assigned to Moid Khan, Ahmed, Shakeel, Ahsan, Shayan Rehman, Mustufa.',
        isSystem: false,
    },
    {
        name: 'product-info',
        description: 'Product / Item information management. Assigned to Mustufa & Imran Khalid.',
        isSystem: false,
    },
];
const EMPLOYEE_BASE_PATTERNS = [
    'hr.dashboard.view',
    'hr.attendance.view',
    'hr.attendance.request',
    'hr.attendance.summary',
    'hr.attendance.request-list',
    'hr.leave.create',
    'hr.leave.read',
    'hr.loan-request.create',
    'hr.loan-request.read',
    'hr.advance-salary.create',
    'hr.advance-salary.read',
    'hr.leave-encashment.create',
    'hr.leave-encashment.read',
    'hr.holiday.read',
    'hr.working-hour-policy.read',
];
function matches(permName, patterns) {
    return patterns.some((p) => {
        if (p.endsWith('.*'))
            return permName.startsWith(p.slice(0, -2));
        return permName === p;
    });
}
const POS_PATTERNS = [
    'pos.*',
];
const ERP_MONITORING_PATTERNS = [
    'erp.dashboard.*',
    'erp.inventory.*',
    'erp.item.read',
    'erp.procurement.pr.read',
    'erp.procurement.rfq.read',
    'erp.procurement.vq.read',
    'erp.procurement.vq.compare',
    'erp.procurement.po.read',
    'erp.procurement.grn.read',
    'erp.procurement.landed-cost.read',
    'erp.procurement.pi.read',
    'erp.procurement.pret.read',
    'erp.procurement.dn.read',
    'erp.claims.read',
];
const LOCAL_PURCHASE_PATTERNS = [
    'erp.procurement.pr.*',
    'erp.procurement.rfq.*',
    'erp.procurement.vq.*',
    'erp.procurement.po.*',
    'erp.procurement.grn.*',
    'erp.procurement.landed-cost.*',
    'erp.procurement.pi.*',
    'erp.procurement.pret.*',
    'erp.procurement.dn.*',
    'erp.item.read',
    'master.brand.read',
];
const INVENTORY_MOVE_PATTERNS = [
    'erp.inventory.view',
    'erp.inventory.explorer.view',
    'erp.inventory.transfer.create',
    'erp.inventory.stock-transfer.*',
    'erp.inventory.stock-ledger.*',
    'erp.inventory.return-transfer.*',
    'erp.inventory.delivery-note.*',
    'erp.inventory.warehouse.view',
    'erp.inventory.warehouse.inventory.view',
];
const INVENTORY_MGMT_PATTERNS = [
    'erp.inventory.*',
    'erp.item.read',
    'erp.item.create',
    'erp.item.update',
    'erp.item.bulk-upload',
    'erp.dashboard.inventory.*',
];
const PRODUCT_INFO_PATTERNS = [
    'erp.item.*',
    'master.brand.*',
    'master.division.*',
    'master.channel-class.*',
    'master.color.*',
    'master.gender.*',
    'master.size.*',
    'master.silhouette.*',
    'master.season.*',
    'master.old-season.*',
    'master.segment.*',
    'master.item-class.*',
    'master.item-subclass.*',
    'master.tax-rate.*',
    'master.hs-code.*',
    'master.category.*',
    'master.sub-category.*',
];
function permissionsForRole(roleName, allPermNames) {
    let rolePerms = [];
    switch (roleName) {
        case 'super-admin':
            return allPermNames;
        case 'pos-monitoring':
            rolePerms = allPermNames.filter((n) => matches(n, POS_PATTERNS) || matches(n, ERP_MONITORING_PATTERNS));
            break;
        case 'local-purchase':
            rolePerms = allPermNames.filter((n) => matches(n, LOCAL_PURCHASE_PATTERNS));
            break;
        case 'pos-inventory-move':
            rolePerms = allPermNames.filter((n) => matches(n, POS_PATTERNS) || matches(n, INVENTORY_MOVE_PATTERNS));
            break;
        case 'pos-inventory-mgmt':
            rolePerms = allPermNames.filter((n) => matches(n, POS_PATTERNS) || matches(n, INVENTORY_MGMT_PATTERNS));
            break;
        case 'pos-only':
            rolePerms = allPermNames.filter((n) => matches(n, POS_PATTERNS));
            break;
        case 'product-info':
            rolePerms = allPermNames.filter((n) => matches(n, PRODUCT_INFO_PATTERNS));
            break;
        default:
            return [];
    }
    const employeePerms = allPermNames.filter((n) => EMPLOYEE_BASE_PATTERNS.includes(n));
    return [...new Set([...rolePerms, ...employeePerms])];
}
async function main() {
    console.log('🚀 Starting POS Role Seeding...\n');
    try {
        const allPermissions = await prisma.permission.findMany();
        if (allPermissions.length === 0) {
            console.error('❌ No permissions found in DB. Run update-permission.ts first.');
            process.exit(1);
        }
        console.log(`📋 Loaded ${allPermissions.length} permissions from DB.\n`);
        const permByName = new Map(allPermissions.map((p) => [p.name, p]));
        const allPermNames = allPermissions.map((p) => p.name);
        console.log('📁 Upserting roles...');
        const roleMap = new Map();
        for (const roleDef of ROLES) {
            const existing = await prisma.role.findFirst({
                where: { name: { equals: roleDef.name, mode: 'insensitive' } },
            });
            let roleId;
            if (existing) {
                await prisma.role.update({
                    where: { id: existing.id },
                    data: { description: roleDef.description, isSystem: roleDef.isSystem },
                });
                roleId = existing.id;
                console.log(`  ✓ Updated: ${roleDef.name}`);
            }
            else {
                const created = await prisma.role.create({ data: roleDef });
                roleId = created.id;
                console.log(`  ➕ Created: ${roleDef.name}`);
            }
            roleMap.set(roleDef.name, roleId);
        }
        console.log('\n🔑 Assigning permissions...');
        for (const roleDef of ROLES) {
            const roleId = roleMap.get(roleDef.name);
            const targetPerms = permissionsForRole(roleDef.name, allPermNames);
            console.log(`\n  Role: ${roleDef.name} → ${targetPerms.length} permissions`);
            const existing = await prisma.rolePermission.findMany({
                where: { roleId },
                include: { permission: true },
            });
            const existingPermNames = new Set(existing.map((rp) => rp.permission.name));
            const targetSet = new Set(targetPerms);
            const toDelete = existing.filter((rp) => !targetSet.has(rp.permission.name));
            if (toDelete.length > 0) {
                await prisma.rolePermission.deleteMany({
                    where: { id: { in: toDelete.map((rp) => rp.id) } },
                });
                console.log(`    🗑  Removed ${toDelete.length} stale permissions`);
            }
            let added = 0;
            for (const permName of targetPerms) {
                if (existingPermNames.has(permName))
                    continue;
                const perm = permByName.get(permName);
                if (!perm) {
                    console.warn(`    ⚠️  Permission not found in DB: ${permName}`);
                    continue;
                }
                await prisma.rolePermission.create({
                    data: { roleId, permissionId: perm.id },
                });
                added++;
            }
            console.log(`    ✅ Added ${added} new permissions`);
        }
        console.log('\n🎉 Role seeding completed successfully!');
        console.log('\n📌 Role summary (all non-super-admin roles include employee self-service permissions):');
        console.log('  super-admin        → Faheem Akhter, Junaid Rasheed  [ALL permissions]');
        console.log('  pos-monitoring     → Anwarullah Ansari, Rehan        [POS + ERP monitoring + employee base]');
        console.log('  local-purchase     → Numair Arshad                   [Procurement + employee base]');
        console.log('  pos-inventory-move → Nasir Jamal                     [POS + inventory movement + employee base]');
        console.log('  pos-inventory-mgmt → Hasan Tanveer, Sheheryar        [POS + full inventory + employee base]');
        console.log('  pos-only           → Moid Khan, Ahmed, Shakeel, Ahsan, Shayan Rehman [POS + employee base]');
        console.log('  product-info       → Mustufa, Imran Khalid           [Item/product masters + employee base]');
        console.log('\n  ℹ️  Assign roles to users manually via the admin panel.');
    }
    catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
    finally {
        await prisma.$disconnect();
        await pool.end();
    }
}
main();
//# sourceMappingURL=seed-pos-roles.js.map