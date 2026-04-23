// @ts-nocheck
/**
 * seed-pos-roles.ts
 *
 * Creates the following roles and assigns permissions to each.
 * Run with:  npx ts-node -r dotenv/config scripts/seed-pos-roles.ts
 *
 * Role → Permission mapping:
 *
 * super-admin          → ALL permissions  (*)
 * pos-monitoring       → POS + ERP read/view (no Finance, no HR)
 * local-purchase       → erp.procurement.pr.*, erp.procurement.rfq.*, erp.procurement.vq.*,
 *                        erp.procurement.po.*, erp.procurement.grn.*, erp.procurement.landed-cost.*
 * pos-inventory-move   → POS + inventory movement (transfer, receiving, returns, inbound, outbound)
 * pos-inventory-mgmt   → POS + full inventory management
 * pos-only             → POS module only
 * product-info         → erp.item.*, master.brand.*, master.division.*, master.channel-class.*,
 *                        master.color.*, master.gender.*, master.size.*, master.silhouette.*,
 *                        master.season.*, master.segment.*, master.item-class.*, master.item-subclass.*
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/management-client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL_MANAGEMENT });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

// ─── Role definitions ────────────────────────────────────────────────────────

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

// ─── Base employee self-service permissions (assigned to ALL non-super-admin roles) ──
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
  'hr.employee.read',
  'hr.employee.user-account',
];

/**
 * Returns true if the permission name matches any of the given prefix patterns.
 * A pattern ending with '.*' matches any permission starting with that prefix.
 * An exact string matches only that permission.
 */
function matches(permName: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    if (p.endsWith('.*')) return permName.startsWith(p.slice(0, -2));
    return permName === p;
  });
}

// All POS permissions
const POS_PATTERNS = [
  'pos.*',
];

// ERP read/monitoring — view + read actions, no create/update/delete on sensitive modules
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

// Local purchase & landed cost
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

// Inventory movement — transfers, receiving, returns (subset of inventory)
const INVENTORY_MOVE_PATTERNS = [
  'erp.inventory.view',
  'erp.inventory.explorer.view',
  'erp.inventory.transfer.create',
  'erp.inventory.stock-transfer.*',
  'erp.inventory.stock-received.*',
  'erp.inventory.return-transfer.*',
  'erp.inventory.delivery-note.*',
  'erp.inventory.warehouse.view',
  'erp.inventory.warehouse.inventory.view',
];

// Full inventory management
const INVENTORY_MGMT_PATTERNS = [
  'erp.inventory.*',
  'erp.item.read',
  'erp.item.create',
  'erp.item.update',
  'erp.item.bulk-upload',
  'erp.dashboard.inventory.*',
];

// Product information
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

// ─── Map role name → permission filter function ───────────────────────────────

function permissionsForRole(roleName: string, allPermNames: string[]): string[] {
  let rolePerms: string[] = [];

  switch (roleName) {
    case 'super-admin':
      return allPermNames; // everything, no employee base needed

    case 'pos-monitoring':
      rolePerms = allPermNames.filter((n) =>
        matches(n, POS_PATTERNS) || matches(n, ERP_MONITORING_PATTERNS)
      );
      break;

    case 'local-purchase':
      rolePerms = allPermNames.filter((n) => matches(n, LOCAL_PURCHASE_PATTERNS));
      break;

    case 'pos-inventory-move':
      rolePerms = allPermNames.filter((n) =>
        matches(n, POS_PATTERNS) || matches(n, INVENTORY_MOVE_PATTERNS)
      );
      break;

    case 'pos-inventory-mgmt':
      rolePerms = allPermNames.filter((n) =>
        matches(n, POS_PATTERNS) || matches(n, INVENTORY_MGMT_PATTERNS)
      );
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

  // Add employee base permissions to all non-super-admin roles
  const employeePerms = allPermNames.filter((n) => EMPLOYEE_BASE_PATTERNS.includes(n));
  return [...new Set([...rolePerms, ...employeePerms])]; // dedupe
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Starting POS Role Seeding...\n');

  try {
    // 1. Load all permissions from DB
    const allPermissions = await prisma.permission.findMany();
    if (allPermissions.length === 0) {
      console.error('❌ No permissions found in DB. Run update-permission.ts first.');
      process.exit(1);
    }
    console.log(`📋 Loaded ${allPermissions.length} permissions from DB.\n`);

    const permByName = new Map(allPermissions.map((p) => [p.name, p]));
    const allPermNames = allPermissions.map((p) => p.name);

    // 2. Upsert roles
    console.log('📁 Upserting roles...');
    const roleMap = new Map<string, string>(); // name → id

    for (const roleDef of ROLES) {
      const existing = await prisma.role.findFirst({
        where: { name: { equals: roleDef.name, mode: 'insensitive' } },
      });

      let roleId: string;
      if (existing) {
        await prisma.role.update({
          where: { id: existing.id },
          data: { description: roleDef.description, isSystem: roleDef.isSystem },
        });
        roleId = existing.id;
        console.log(`  ✓ Updated: ${roleDef.name}`);
      } else {
        const created = await prisma.role.create({ data: roleDef });
        roleId = created.id;
        console.log(`  ➕ Created: ${roleDef.name}`);
      }
      roleMap.set(roleDef.name, roleId);
    }

    // 3. Assign permissions to each role
    console.log('\n🔑 Assigning permissions...');

    for (const roleDef of ROLES) {
      const roleId = roleMap.get(roleDef.name)!;
      const targetPerms = permissionsForRole(roleDef.name, allPermNames);

      console.log(`\n  Role: ${roleDef.name} → ${targetPerms.length} permissions`);

      // Remove permissions no longer in the target set (clean sync)
      const existing = await prisma.rolePermission.findMany({
        where: { roleId },
        include: { permission: true },
      });
      const existingPermNames = new Set(existing.map((rp) => rp.permission.name));
      const targetSet = new Set(targetPerms);

      // Delete stale
      const toDelete = existing.filter((rp) => !targetSet.has(rp.permission.name));
      if (toDelete.length > 0) {
        await prisma.rolePermission.deleteMany({
          where: { id: { in: toDelete.map((rp) => rp.id) } },
        });
        console.log(`    🗑  Removed ${toDelete.length} stale permissions`);
      }

      // Add new
      let added = 0;
      for (const permName of targetPerms) {
        if (existingPermNames.has(permName)) continue;
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

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
