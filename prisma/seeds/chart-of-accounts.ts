import 'dotenv/config';
import { PrismaClient, AccountType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

export const chartOfAccountsData = [
  // 1. ASSETS
  {
    code: '10000',
    name: 'Assets',
    type: AccountType.ASSET,
    isGroup: true,
    children: [
      {
        code: '11000',
        name: 'Current Assets',
        type: AccountType.ASSET,
        isGroup: true,
        children: [
          {
            code: '11100',
            name: 'Cash and Cash Equivalents',
            type: AccountType.ASSET,
            isGroup: true,
            children: [
              { code: '11110', name: 'Petty Cash', type: AccountType.ASSET, isGroup: false },
              { code: '11120', name: 'Cash on Hand', type: AccountType.ASSET, isGroup: false },
              { code: '11130', name: 'Bank - Current Account', type: AccountType.ASSET, isGroup: false },
              { code: '11140', name: 'Bank - Savings Account', type: AccountType.ASSET, isGroup: false },
            ]
          },
          {
            code: '11200',
            name: 'Accounts Receivable',
            type: AccountType.ASSET,
            isGroup: true,
            children: [
              { code: '11210', name: 'Trade Debtors', type: AccountType.ASSET, isGroup: false },
              { code: '11220', name: 'Employee Advances', type: AccountType.ASSET, isGroup: false },
              { code: '11230', name: 'Prepayments', type: AccountType.ASSET, isGroup: false },
            ]
          },
          {
            code: '11300',
            name: 'Inventory',
            type: AccountType.ASSET,
            isGroup: true,
            children: [
              { code: '11310', name: 'Raw Materials', type: AccountType.ASSET, isGroup: false },
              { code: '11320', name: 'Work in Progress', type: AccountType.ASSET, isGroup: false },
              { code: '11330', name: 'Finished Goods', type: AccountType.ASSET, isGroup: false },
            ]
          }
        ]
      },
      {
        code: '12000',
        name: 'Non-Current Assets',
        type: AccountType.ASSET,
        isGroup: true,
        children: [
          {
            code: '12100',
            name: 'Property, Plant and Equipment',
            type: AccountType.ASSET,
            isGroup: true,
            children: [
              { code: '12110', name: 'Land', type: AccountType.ASSET, isGroup: false },
              { code: '12120', name: 'Buildings', type: AccountType.ASSET, isGroup: false },
              { code: '12130', name: 'Machinery', type: AccountType.ASSET, isGroup: false },
              { code: '12140', name: 'Vehicles', type: AccountType.ASSET, isGroup: false },
              { code: '12150', name: 'Computer Equipment', type: AccountType.ASSET, isGroup: false },
              { code: '12160', name: 'Furniture and Fixtures', type: AccountType.ASSET, isGroup: false },
            ]
          },
          {
            code: '12200',
            name: 'Intangible Assets',
            type: AccountType.ASSET,
            isGroup: true,
            children: [
              { code: '12210', name: 'Goodwill', type: AccountType.ASSET, isGroup: false },
              { code: '12220', name: 'Software Licenses', type: AccountType.ASSET, isGroup: false },
            ]
          }
        ]
      }
    ]
  },
  // 2. LIABILITIES
  {
    code: '20000',
    name: 'Liabilities',
    type: AccountType.LIABILITY,
    isGroup: true,
    children: [
      {
        code: '21000',
        name: 'Current Liabilities',
        type: AccountType.LIABILITY,
        isGroup: true,
        children: [
          {
            code: '21100',
            name: 'Accounts Payable',
            type: AccountType.LIABILITY,
            isGroup: true,
            children: [
              { code: '21110', name: 'Trade Creditors', type: AccountType.LIABILITY, isGroup: false },
              { code: '21120', name: 'Accrued Expenses', type: AccountType.LIABILITY, isGroup: false },
            ]
          },
          {
            code: '21200',
            name: 'Tax Payable',
            type: AccountType.LIABILITY,
            isGroup: true,
            children: [
              { code: '21210', name: 'VAT/GST Payable', type: AccountType.LIABILITY, isGroup: false },
              { code: '21220', name: 'Income Tax Payable', type: AccountType.LIABILITY, isGroup: false },
              { code: '21230', name: 'Withholding Tax Payable', type: AccountType.LIABILITY, isGroup: false },
            ]
          },
          {
            code: '21300',
            name: 'Short Term Loans',
            type: AccountType.LIABILITY,
            isGroup: true,
            children: [
              { code: '21310', name: 'Bank Overdraft', type: AccountType.LIABILITY, isGroup: false },
            ]
          }
        ]
      },
      {
        code: '22000',
        name: 'Non-Current Liabilities',
        type: AccountType.LIABILITY,
        isGroup: true,
        children: [
          { code: '22100', name: 'Long Term Bank Loans', type: AccountType.LIABILITY, isGroup: false },
        ]
      }
    ]
  },
  // 3. EQUITY
  {
    code: '30000',
    name: 'Equity',
    type: AccountType.EQUITY,
    isGroup: true,
    children: [
      { code: '31000', name: 'Share Capital', type: AccountType.EQUITY, isGroup: false },
      { code: '32000', name: 'Retained Earnings', type: AccountType.EQUITY, isGroup: false },
      { code: '33000', name: 'Owner\'s Draw', type: AccountType.EQUITY, isGroup: false },
    ]
  },
  // 4. INCOME
  {
    code: '40000',
    name: 'Income',
    type: AccountType.INCOME,
    isGroup: true,
    children: [
      {
        code: '41000',
        name: 'Operating Income',
        type: AccountType.INCOME,
        isGroup: true,
        children: [
          { code: '41100', name: 'Sales Revenue', type: AccountType.INCOME, isGroup: false },
          { code: '41200', name: 'Service Revenue', type: AccountType.INCOME, isGroup: false },
          { code: '41300', name: 'Sales Returns and Allowances', type: AccountType.INCOME, isGroup: false },
        ]
      },
      {
        code: '42000',
        name: 'Non-Operating Income',
        type: AccountType.INCOME,
        isGroup: true,
        children: [
          { code: '42100', name: 'Interest Income', type: AccountType.INCOME, isGroup: false },
          { code: '42200', name: 'Gain on Asset Disposal', type: AccountType.INCOME, isGroup: false },
        ]
      }
    ]
  },
  // 5. EXPENSES
  {
    code: '50000',
    name: 'Expenses',
    type: AccountType.EXPENSE,
    isGroup: true,
    children: [
      {
        code: '51000',
        name: 'Cost of Goods Sold',
        type: AccountType.EXPENSE,
        isGroup: true,
        children: [
          { code: '51100', name: 'Purchases', type: AccountType.EXPENSE, isGroup: false },
          { code: '51200', name: 'Freight In', type: AccountType.EXPENSE, isGroup: false },
        ]
      },
      {
        code: '52000',
        name: 'Operating Expenses',
        type: AccountType.EXPENSE,
        isGroup: true,
        children: [
          {
            code: '52100',
            name: 'Payroll Expenses',
            type: AccountType.EXPENSE,
            isGroup: true,
            children: [
              { code: '52110', name: 'Salaries and Wages', type: AccountType.EXPENSE, isGroup: false },
              { code: '52120', name: 'Employee Benefits', type: AccountType.EXPENSE, isGroup: false },
              { code: '52130', name: 'Payroll Taxes', type: AccountType.EXPENSE, isGroup: false },
            ]
          },
          {
            code: '52200',
            name: 'Administrative Expenses',
            type: AccountType.EXPENSE,
            isGroup: true,
            children: [
              { code: '52210', name: 'Rent Expense', type: AccountType.EXPENSE, isGroup: false },
              { code: '52220', name: 'Utilities Expense', type: AccountType.EXPENSE, isGroup: false },
              { code: '52230', name: 'Telephone and Internet', type: AccountType.EXPENSE, isGroup: false },
              { code: '52240', name: 'Office Supplies', type: AccountType.EXPENSE, isGroup: false },
              { code: '52250', name: 'Repairs and Maintenance', type: AccountType.EXPENSE, isGroup: false },
            ]
          },
          {
            code: '52300',
            name: 'Marketing and Selling Expenses',
            type: AccountType.EXPENSE,
            isGroup: true,
            children: [
              { code: '52310', name: 'Advertising', type: AccountType.EXPENSE, isGroup: false },
              { code: '52320', name: 'Travel and Entertainment', type: AccountType.EXPENSE, isGroup: false },
            ]
          },
          {
            code: '52400',
            name: 'Financial Expenses',
            type: AccountType.EXPENSE,
            isGroup: true,
            children: [
              { code: '52410', name: 'Bank Charges', type: AccountType.EXPENSE, isGroup: false },
              { code: '52420', name: 'Interest Expense', type: AccountType.EXPENSE, isGroup: false },
            ]
          },
           {
            code: '52500',
            name: 'Depreciation and Amortization',
            type: AccountType.EXPENSE,
            isGroup: true,
            children: [
              { code: '52510', name: 'Depreciation Expense', type: AccountType.EXPENSE, isGroup: false },
              { code: '52520', name: 'Amortization Expense', type: AccountType.EXPENSE, isGroup: false },
            ]
          }
        ]
      }
    ]
  }
];

export async function seedChartOfAccounts(prisma: PrismaClient) {
  console.log('🌱 Seeding Chart of Accounts...');

  async function createNode(node: any, parentId: string | null = null) {
    // Check if exists
    let account = await prisma.chartOfAccount.findUnique({
      where: { code: node.code },
    });

    if (!account) {
      account = await prisma.chartOfAccount.create({
        data: {
          code: node.code,
          name: node.name,
          type: node.type,
          isGroup: node.isGroup,
          parentId: parentId,
          isActive: true,
        },
      });
      // console.log(`Created account: ${node.code} - ${node.name}`);
    } else {
        // Update parent if needed to fix structure
        if (account.parentId !== parentId) {
            await prisma.chartOfAccount.update({
                where: { id: account.id },
                data: { parentId: parentId }
            });
        }
    }

    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        await createNode(child, account.id);
      }
    }
  }

  for (const rootNode of chartOfAccountsData) {
    await createNode(rootNode);
  }

  console.log('✅ Chart of Accounts seeded successfully');
}

// Allow direct execution
if (require.main === module) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  seedChartOfAccounts(prisma)
    .catch((e) => {
      console.error('❌ Seed error:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
      await pool.end();
    });
}
