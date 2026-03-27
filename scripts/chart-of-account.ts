import 'dotenv/config';
import { PrismaClient, AccountType } from '@prisma/client';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

export const equityChart: any[] = [
  {
    code: '1',
    name: 'CAPITAL',
    type: 'EQUITY',
    isGroup: true,
    children: [
      {
        code: '10',
        name: "SHARE HOLDERS' EQUITY",
        type: 'EQUITY',
        isGroup: true,
        children: [
          {
            code: '1001',
            name: 'SHARE CAPITAL & RESERVES',
            type: 'EQUITY',
            isGroup: true,
            children: [
              {
                code: '10010001',
                name: 'AUTHORIZED CAPITAL',
                type: 'EQUITY',
                isGroup: false,
              },
              {
                code: '10010002',
                name: 'SHARE PREMIUM',
                type: 'EQUITY',
                isGroup: false,
              },
            ],
          },
          {
            code: '1002',
            name: 'UN APPROPRIATED PROFIT/(LOSS)',
            type: 'EQUITY',
            isGroup: true,
            children: [
              {
                code: '10020001',
                name: 'UN APPROPRIATED PROFIT/(LOSS)',
                type: 'EQUITY',
                isGroup: false,
              },
              {
                code: '10020002',
                name: 'DIVIDEND',
                type: 'EQUITY',
                isGroup: false,
              },
            ],
          },
          {
            code: '1003',
            name: 'RESERVES',
            type: 'EQUITY',
            isGroup: true,
            children: [
              {
                code: '10030001',
                name: 'CAPITAL RESERVES',
                type: 'EQUITY',
                isGroup: false,
              },
              {
                code: '10030002',
                name: 'REVENUE RESERVES',
                type: 'EQUITY',
                isGroup: false,
              },
              {
                code: '10030003',
                name: 'ADVANCE AGAINST EQUITY',
                type: 'EQUITY',
                isGroup: false,
              },
            ],
          },
          {
            code: '1004',
            name: 'SUBORDINATED LOAN',
            type: 'EQUITY',
            isGroup: true,
            children: [
              {
                code: '10040001',
                name: 'LOAN FROM DIRECTORS',
                type: 'EQUITY',
                isGroup: false,
              },
            ],
          },
        ],
      },
    ],
  },
];

export const liabilitiesChart: any[] = [
  {
    code: '2',
    name: 'LIABILITIES',
    type: 'LIABILITY',
    isGroup: true,
    children: [
      {
        code: '11',
        name: 'NON CURRENT LIABILITIES',
        type: 'LIABILITY',
        isGroup: true,
        children: [
          {
            code: '1101',
            name: 'LONG TERM LOAN-SECURED',
            type: 'LIABILITY',
            isGroup: true,
            children: [
              {
                code: '11010001',
                name: 'LT LOAN-SECURED',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '11010002',
                name: 'DEFERRED GRANT',
                type: 'LIABILITY',
                isGroup: false,
              },
            ],
          },
          {
            code: '1102',
            name: 'LONG TERM LOAN-UN SECURED',
            type: 'LIABILITY',
            isGroup: true,
            children: [
              {
                code: '11020001',
                name: 'LT LOAN-UN SECURED',
                type: 'LIABILITY',
                isGroup: false,
              },
            ],
          },
          {
            code: '1103',
            name: 'LONG TERM DEPOSITS-P/A',
            type: 'LIABILITY',
            isGroup: true,
            children: [
              {
                code: '11030001',
                name: 'LONG TERM DEPOSITS P/A-SPORTS BRANDS',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '11030002',
                name: 'LONG TERM DEPOSITS P/A-WATCHES',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '11030003',
                name: 'LONG TERM DEPOSITS P/A-OTHERS',
                type: 'LIABILITY',
                isGroup: false,
              },
            ],
          },
          {
            code: '1104',
            name: 'LEASE LIABILITY',
            type: 'LIABILITY',
            isGroup: true,
            children: [
              {
                code: '11040001',
                name: 'LEASE LIABILITY',
                type: 'LIABILITY',
                isGroup: false,
              },
            ],
          },
          {
            code: '1105',
            name: 'DEFERRED COST',
            type: 'LIABILITY',
            isGroup: true,
            children: [
              {
                code: '11050001',
                name: 'DEFERRED COST',
                type: 'LIABILITY',
                isGroup: false,
              },
            ],
          },
        ],
      },
      {
        code: '12',
        name: 'CURRENT LIABILITIES',
        type: 'LIABILITY',
        isGroup: true,
        children: [
          {
            code: '1201',
            name: 'TRADE CREDITORS',
            type: 'LIABILITY',
            isGroup: true,
            children: [
              {
                code: '12010001',
                name: 'BILLS PAYABLE-IMPORTS SPORTS BRANDS',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12010002',
                name: 'BILLS PAYABLE-IMPORTS FASHION BRANDS',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12010003',
                name: 'BILLS PAYABLE-IMPORTS WATCH BRNDS',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12010004',
                name: 'BILLS PAYABLE-LOCAL',
                type: 'LIABILITY',
                isGroup: false,
              },
            ],
          },
          {
            code: '1202',
            name: 'ADVANCE CUSTOMERS-UNSECURED',
            type: 'LIABILITY',
            isGroup: true,
            children: [
              {
                code: '12020001',
                name: 'ADVANCE FROM CUSTOMERS',
                type: 'LIABILITY',
                isGroup: false,
              },
            ],
          },
          {
            code: '1203',
            name: 'ACCRUED LIABILITIES',
            type: 'LIABILITY',
            isGroup: true,
            children: [
              {
                code: '12030001',
                name: 'A/P PARTIES',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12030002',
                name: 'A/P EMPLOYEES',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12030003',
                name: 'A/P SALARIES',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12030004',
                name: 'A/P PROVIDENT FUND',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12030005',
                name: 'A/P EOBI',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12030006',
                name: 'A/P SESSI/PESSI/IESSI',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12030007',
                name: 'A/P SALARIES-FINAL SETTLEMENT',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12030008',
                name: 'A/P P.O.-NIKE',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12030009',
                name: 'A/P P.O.-ADIDAS',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12030010',
                name: 'A/P P.O.-PUMA',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12030011',
                name: 'A/P P.O.-SPEED SPORTS',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12030012',
                name: 'A/P P.O.-CHARLES & KEITH',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12030013',
                name: 'A/P P.O.-PEDRO',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12030014',
                name: 'A/P P.O.-WATCHE BRANDS',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12030015',
                name: 'PROVISION FOR EXPENSES',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12030016',
                name: 'PROVISION FOR BONUS',
                type: 'LIABILITY',
                isGroup: false,
              },
            ],
          },
          {
            code: '1204',
            name: 'SALES TAX PAYABLE',
            type: 'LIABILITY',
            isGroup: true,
            children: [
              {
                code: '12040001',
                name: 'SALES TAX PAYABLE-FEDERAL',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12040002',
                name: 'SALES TAX PAYABLE-PROVINCIAL',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12040003',
                name: 'SALES TAX WITHHELD ON PURCHASES',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12040004',
                name: 'SALES TAX WITHHELD SRB',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12040005',
                name: 'SALES TAX WITHHELD PRA',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12040006',
                name: 'SALES TAX WITHHELD ICT',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12040007',
                name: 'SALES TAX WITHHELD ON SALES',
                type: 'LIABILITY',
                isGroup: false,
              },
            ],
          },
          {
            code: '1205',
            name: "WORKERS' WELFARE FUND PAYABLE",
            type: 'LIABILITY',
            isGroup: true,
            children: [
              {
                code: '12050001',
                name: "WORKERS'S WELFARE FUND PAYABLE",
                type: 'LIABILITY',
                isGroup: false,
              },
            ],
          },
          {
            code: '1206',
            name: 'DUTY & TAXES PAYABLE',
            type: 'LIABILITY',
            isGroup: true,
            children: [
              {
                code: '12060001',
                name: 'WH TAX PAYABLE-SALARY',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12060002',
                name: 'WH TAX PAYABLE-DIVIDEND',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12060003',
                name: 'WH TAX PAYABLE-GOODS',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12060004',
                name: 'WH TAX PAYABLE-SERVICES',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12060005',
                name: 'WH TAX PAYABLE-RENT',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12060006',
                name: 'WH TAX PAYABLE-COMMISSION',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12060007',
                name: 'WH TAX PAYABLE-RETAILERS',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12060008',
                name: 'DUTY & TAXES PAYABLE',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12060009',
                name: 'POS INTEGRATION FEE - PAYABLE',
                type: 'LIABILITY',
                isGroup: false,
              },
            ],
          },
          {
            code: '1207',
            name: 'OTHER LIABILITIES',
            type: 'LIABILITY',
            isGroup: true,
            children: [
              {
                code: '12070001',
                name: 'SHORT TERM LOAN',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12070002',
                name: 'CURRENT ACCOUNT-CASH',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12070003',
                name: 'CURRENT ACCOUNT-CARDS',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12070004',
                name: 'CURRENT ACCOUNT-WHOLE SALES',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12070005',
                name: 'CURRENT ACCOUNT-AFTER SALES',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12070006',
                name: 'CREDIT VOUCHERS',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12070007',
                name: 'GIFT VOUCHERS',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12070008',
                name: 'GIFT VOUCHERS CORPORATE',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12070009',
                name: 'CLAIM VOUCHERS',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12070010',
                name: 'EXCHANGE VOUCHERS',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12070011',
                name: 'ALLIANCE & REWARD PROGRAM',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12070012',
                name: 'ADVANCE AG. PURC. OF VEHICLE',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12070013',
                name: 'RETENTION MONEY PAYABLE',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12070014',
                name: 'PROVISION FOR IMPAIRMENT',
                type: 'LIABILITY',
                isGroup: false,
              },
            ],
          },
          {
            code: '1208',
            name: 'CURRENT MATURITY OF LEASE LIABILITY',
            type: 'LIABILITY',
            isGroup: true,
            children: [
              {
                code: '12080001',
                name: 'CURRENT MATURITY OF LEASE LIABILITY',
                type: 'LIABILITY',
                isGroup: false,
              },
            ],
          },
          {
            code: '1209',
            name: 'TAXATION-NET',
            type: 'LIABILITY',
            isGroup: true,
            children: [
              {
                code: '12090001',
                name: 'PROVISION FOR TAXATION',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12090002',
                name: 'TAX PAYABLE-OTHERS',
                type: 'LIABILITY',
                isGroup: false,
              },
            ],
          },
          {
            code: '1210',
            name: 'PROVISION FOR SALES TAX',
            type: 'LIABILITY',
            isGroup: true,
            children: [
              {
                code: '12100001',
                name: 'PROVISION FOR SALES TAX',
                type: 'LIABILITY',
                isGroup: false,
              },
            ],
          },
          {
            code: '1211',
            name: 'ACCREUD MARK UP ON LOAN',
            type: 'LIABILITY',
            isGroup: true,
            children: [
              {
                code: '12110001',
                name: 'ACC MARK UP ON RF',
                type: 'LIABILITY',
                isGroup: false,
              },
              {
                code: '12110002',
                name: 'ACC MARK UP ON SHORT TERM LOAN',
                type: 'LIABILITY',
                isGroup: false,
              },
            ],
          },
        ],
      },
    ],
  },
];

export const assetsChart: any[] = [
  {
    code: '3',
    name: 'ASSETS',
    type: 'ASSET',
    isGroup: true,
    children: [
      {
        code: '30',
        name: 'NON CURRENT ASSETS',
        type: 'ASSET',
        isGroup: true,
        children: [
          {
            code: '3001',
            name: 'PROPERTY, PLANT AND EQUIPMENT-OWN',
            type: 'ASSET',
            isGroup: true,
            children: [
              {
                code: '30010001',
                name: 'LEASE HOLD IMPROVEMENTS-OWN',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30010002',
                name: 'FURNITURE, FIXTURES & FITTINGS-OWN',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30010003',
                name: 'OFFICE EQUIPMENTS-OWN',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30010004',
                name: 'COMPUTERS-OWN',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30010005',
                name: 'MOTOR VEHICLES-OWN',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30010051',
                name: 'ACC. DEP. LEASE HOLD IMPORVEMENTS-OWN',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30010052',
                name: 'ACC. DEP. FURNITURE, FIXTURES & FITTINGS-OWN',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30010053',
                name: 'ACC. DEP. OFFICE EQUIPMENTS-OWN',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30010054',
                name: 'ACC. DEP. COMPUTERS-OWN',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30010055',
                name: 'ACC. DEP. MOTOR VEHICLES-OWN',
                type: 'ASSET',
                isGroup: false,
              },
            ],
          },
          {
            code: '3002',
            name: 'CAPITAL WORK IN PROGRESS',
            type: 'ASSET',
            isGroup: true,
            children: [
              {
                code: '30020001',
                name: 'CWIP-LEASE HOLD IMPROVEMENTS',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30020002',
                name: 'CWIP-FURNITURE, FIXTURES & FITTINGS',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30020003',
                name: 'CWIP-OFFICE EQUIPMENTS',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30020004',
                name: 'CWIP-COMPUTERS',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30020005',
                name: 'CWIP-MOTOR VEHICLES',
                type: 'ASSET',
                isGroup: false,
              },
            ],
          },
          {
            code: '3003',
            name: 'INTENGIBLES',
            type: 'ASSET',
            isGroup: true,
            children: [
              {
                code: '30030001',
                name: 'SOFTWARE',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30030051',
                name: 'ACCUMULATED AMORTIZATION',
                type: 'ASSET',
                isGroup: false,
              },
            ],
          },
          {
            code: '3004',
            name: 'RIGHT OF USE ASSETS',
            type: 'ASSET',
            isGroup: true,
            children: [
              {
                code: '30040001',
                name: 'RIGHT OF USE ASSETS-BUILDING',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30040051',
                name: 'ACC. DEP. RIGHT OF ASSETS-BUILDING',
                type: 'ASSET',
                isGroup: false,
              },
            ],
          },
          {
            code: '3005',
            name: 'PROPERTY, PLANT & EQUIPMENT-LEASED',
            type: 'ASSET',
            isGroup: true,
            children: [
              {
                code: '30050001',
                name: 'LEASE HOLD IMPROVEMENTS-LEASED',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30050002',
                name: 'FURNITURE, FIXTURES & FITTINGS-LEASED',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30050003',
                name: 'OFFICE EQUIPMENTS-LEASED',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30050004',
                name: 'COMPUTERS-LEASED',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30050005',
                name: 'MOTOR VEHICLES-LEASED',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30050051',
                name: 'ACC. DEP. OFFICE & SHOPS BUILDUPS-LEASED',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30050052',
                name: 'ACC. DEP. FURNITURE, FIXTURES & FITTINGS-LEASED',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30050053',
                name: 'ACC. DEP. OFFICE EQUIPMENTS-LEASED',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30050054',
                name: 'ACC. DEP. COMPUTERS-LEASED',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30050055',
                name: 'ACC. DEP. MOTOR VEHICLES-LEASED',
                type: 'ASSET',
                isGroup: false,
              },
            ],
          },
          {
            code: '3006',
            name: 'INVESTMENTS',
            type: 'ASSET',
            isGroup: true,
            children: [
              {
                code: '30060001',
                name: 'INVESTMENT',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30060002',
                name: 'TERM DEPOSIT',
                type: 'ASSET',
                isGroup: false,
              },
            ],
          },
          {
            code: '3007',
            name: 'LONG TERM DEPOSITS R/A',
            type: 'ASSET',
            isGroup: true,
            children: [
              {
                code: '30070001',
                name: 'LONG TERM DEPOSITS R/A-RENT',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '30070002',
                name: 'LONG TERM DEPOSITS R/A-OTHERS',
                type: 'ASSET',
                isGroup: false,
              },
            ],
          },
        ],
      },
      {
        code: '31',
        name: 'CURRENT ASSETS',
        type: 'ASSET',
        isGroup: true,
        children: [
          {
            code: '3101',
            name: 'STOCK IN TRADE',
            type: 'ASSET',
            isGroup: true,
            children: [
              {
                code: '31010001',
                name: 'STOCK AT END-STORES',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31010002',
                name: 'STOCK AT END-WAREHOUSE',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31010003',
                name: 'STOCK AT END-SPARE PARTS',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31010004',
                name: 'CONSIGNMENT STOCK',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31010005',
                name: 'STOCK IN TRANSIT',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31010006',
                name: 'PROVISION FOR STOCKS',
                type: 'ASSET',
                isGroup: false,
              },
            ],
          },
          {
            code: '3102',
            name: 'TRADE DEBTS-NET',
            type: 'ASSET',
            isGroup: true,
            children: [
              {
                code: '31020001',
                name: 'A/R-SPORTS BRANDS',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31020002',
                name: 'A/R-INSTITUTES',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31020003',
                name: 'A/R-WATCHES',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31020004',
                name: 'A/R-AFTER SALES',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31020005',
                name: 'ALLOWANCE FOR EXPECTED CREDIT LOSE',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31020006',
                name: 'PROVISION FOR BAD DEBTS',
                type: 'ASSET',
                isGroup: false,
              },
            ],
          },
          {
            code: '3103',
            name: 'LOAN AND ADVANCES',
            type: 'ASSET',
            isGroup: true,
            children: [
              {
                code: '31030001',
                name: 'ADVANCE AGAINST SALARY',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31030002',
                name: 'LOAN TO EMPLOYEES',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31030003',
                name: 'ADVANCE FOR EXPENSES',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31030004',
                name: 'ADVANCE TO SUPPLIERS',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31030005',
                name: 'ASSOCIATED UNDERTAKING',
                type: 'ASSET',
                isGroup: false,
              },
            ],
          },
          {
            code: '3104',
            name: 'SHORT TERM DEPOSITS & PREPAYMENTS',
            type: 'ASSET',
            isGroup: true,
            children: [
              {
                code: '31040001',
                name: 'SECURITY DEPOSIT',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31040002',
                name: 'LC MARGIN',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31040003',
                name: 'PREPAID GENERAL INSURANCE',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31040004',
                name: 'PREPAID GROUP LIFE INSURANCE',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31040005',
                name: 'PREPAID RENT',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31040006',
                name: 'PREPAID SERVICE CHARGES',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31040007',
                name: 'PREPAID ADVERTISEMENT',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31040008',
                name: 'PREPAID PROFESSIONAL CHARGES',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31040009',
                name: 'PREPAID MAINTENANCE CHARGES',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31040010',
                name: 'PREPAID LEASE RENTAL',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31040011',
                name: 'PREPAID OTHERS',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31040012',
                name: 'PREPAID HEALTH INSURANCE',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31040013',
                name: 'PREPAID STAMP DUTY',
                type: 'ASSET',
                isGroup: false,
              },
            ],
          },
          {
            code: '3105',
            name: 'STORES AND SUPPLIES',
            type: 'ASSET',
            isGroup: true,
            children: [
              {
                code: '31050001',
                name: 'PRINTING & STATIONARY',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31050002',
                name: 'OFFICE SUPPLIES',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31050003',
                name: 'JANITORIAL ITEMS',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31050004',
                name: 'ELECTRICAL ACCESSORIES',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31050005',
                name: 'CARRY BAGS',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31050006',
                name: 'UNIFORM',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31050007',
                name: 'VM/CASH DESK MATEIRAL',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31050008',
                name: 'UTILITIES',
                type: 'ASSET',
                isGroup: false,
              },
            ],
          },
          {
            code: '3106',
            name: 'OTHER RECEIVABLES',
            type: 'ASSET',
            isGroup: true,
            children: [
              {
                code: '31060001',
                name: 'DUE FROM RELATED PARTIES',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31060002',
                name: 'INSURANCE CLAIM',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31060003',
                name: 'RECEIVABLES-OTHERS',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31060004',
                name: 'REIMB.ABLE EXP. REC.ABLE',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31060005',
                name: 'SALES TAX REFUNDABLE',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31060006',
                name: 'RECEIVABLES E-COMMERCE',
                type: 'ASSET',
                isGroup: false,
              },
            ],
          },
          {
            code: '3107',
            name: 'SALES TAX CONTROL ACCOUNT',
            type: 'ASSET',
            isGroup: true,
            children: [
              {
                code: '31070001',
                name: 'SALES TAX CURRENT ACCOUNT',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31070002',
                name: 'SALES TAX ON SERVICES',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31070003',
                name: 'SALES TAX ON GOODS',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31070004',
                name: 'SALES TAX ON SERVICES (PRA)',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31070005',
                name: 'SALES TAX ON SERVICES (SRB)',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31070006',
                name: 'SALES TAX ON SERVICES (ICT)',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31070007',
                name: 'SALES TAX-OTHERS',
                type: 'ASSET',
                isGroup: false,
              },
            ],
          },
          {
            code: '3108',
            name: 'TAXATION-NET',
            type: 'ASSET',
            isGroup: true,
            children: [
              {
                code: '31080001',
                name: 'ADVANCE TAX ON IMPORTS',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31080002',
                name: 'ADVANCE TAX ON SUPPLY OF GOODS',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31080003',
                name: 'ADVANCE TAX ON BANK PROFIT',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31080004',
                name: 'ADVANCE TAX WITH RETURNS',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31080005',
                name: 'ADVANCE TAX ON ELECTRICITY',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31080006',
                name: 'ADVANCE TAX ON PHONE-PTCL',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31080007',
                name: 'ADVANCE TAX ON PHONE-MOBILE',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31080008',
                name: 'ADVANCE TAX ON INTERNET',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31080009',
                name: 'ADVANCE TAX ON CASH WITHDRAWAL',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31080010',
                name: 'ADVANCE INCOME TAX U/S 147',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31080011',
                name: 'ADVANCE INCOME TAX E-COMM U/S 6A',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31080012',
                name: 'ADVANCE TAX-OTHERS',
                type: 'ASSET',
                isGroup: false,
              },
            ],
          },
          {
            code: '3109',
            name: 'CASH IN HAND',
            type: 'ASSET',
            isGroup: true,
            children: [
              {
                code: '31090001',
                name: 'CASH IN HAND',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31090002',
                name: 'CASH IMPREST',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31090003',
                name: 'CASH FLOAT',
                type: 'ASSET',
                isGroup: false,
              },
            ],
          },
          {
            code: '3110',
            name: 'BANK BALANCES-CURRENT ACCOUNTS',
            type: 'ASSET',
            isGroup: true,
            children: [
              {
                code: '31100001',
                name: 'STANDARD CHARTERED',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31100002',
                name: 'JS BANK LIMITED',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31100003',
                name: 'JS BANK LIMITED - CURRENT A/C',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31100004',
                name: 'BANK AL-FALAH LIMITED',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31100005',
                name: 'HABIB BANK LIMITED',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31100006',
                name: 'BANK AL-HABIB LIMITED',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31100007',
                name: 'ALLIED BANK LIMITED',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31100008',
                name: 'MEEZAN BANK LIMITED',
                type: 'ASSET',
                isGroup: false,
              },
            ],
          },
          {
            code: '3111',
            name: 'BANK BALANCES-DEPOSIT ACCOUNTS',
            type: 'ASSET',
            isGroup: true,
            children: [
              {
                code: '31110001',
                name: 'STANDARD CHARTERED BANK-SAVING A/C',
                type: 'ASSET',
                isGroup: false,
              },
              {
                code: '31110002',
                name: 'JS BANK LIMITED - SAVING A/C',
                type: 'ASSET',
                isGroup: false,
              },
            ],
          },
          {
            code: '3112',
            name: 'BANK BALANCE-FOREIGN CURRENCY',
            type: 'ASSET',
            isGroup: true,
            children: [
              {
                code: '32030001',
                name: 'STANDARD CHARTERED FC',
                type: 'ASSET',
                isGroup: false,
              },
            ],
          },
        ],
      },
    ],
  },
];

export const revenueChart: any[] = [
  {
    code: '4',
    name: 'REVENUE',
    type: 'INCOME',
    isGroup: true,
    children: [
      {
        code: '40',
        name: 'SALES-NET',
        type: 'INCOME',
        isGroup: true,
        children: [
          {
            code: '4001',
            name: 'WHOLE SALES',
            type: 'INCOME',
            isGroup: true,
            children: [
              {
                code: '40010001',
                name: 'WHOLE SALES',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40010002',
                name: 'WHOLE SALES-TAXABLE 18%',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40010003',
                name: 'WHOLE SALES - TAXABLE 25%',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40010004',
                name: 'WHOLE SALES DISCOUNT',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40010005',
                name: 'WHOLE SALES DISCOUNT 18%',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40010006',
                name: 'WHOLE SALES DISCOUNT 25%',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40010007',
                name: 'WHOLE SALES RETURN',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40010008',
                name: 'WHOLE SALES RETURN 18%',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40010009',
                name: 'WHOLE SALES RETURN 25%',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40010010',
                name: 'WHOLE SALES DISCOUNT RETURN',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40010011',
                name: 'WHOLE SALES DISCOUNT RETURN 18%',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40010012',
                name: 'WHOLE SALES DISCOUNT RETURN 25%',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40010013',
                name: 'SALES TAX-OUTPUT WHOLE SALES',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40010014',
                name: 'WHOLE SALES RETURN-CONTROL A/C',
                type: 'INCOME',
                isGroup: false,
              },
            ],
          },
          {
            code: '4002',
            name: 'RETAIL SALES',
            type: 'INCOME',
            isGroup: true,
            children: [
              {
                code: '40020001',
                name: 'RETAIL SALES',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40020002',
                name: 'RETAIL SALES-TAXABLE 18%',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40020003',
                name: 'RETAIL SALES - TAXABLE 25%',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40020004',
                name: 'RETAIL SALES DISCOUNT',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40020005',
                name: 'RETAIL SALES DISCOUNT-TAXABLE 18%',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40020006',
                name: 'RETAIL SALES DISCOUNT - TAXABLE 25%',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40020007',
                name: 'RETAIL SALES RETURN',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40020008',
                name: 'RETAIL SALES RETURN 18%',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40020009',
                name: 'RETAIL SALES RETURN 25%',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40020010',
                name: 'RETAIL SALES DISCOUNT RETURN',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40020011',
                name: 'RETAIL SALES DISCOUNT RETURN 18%',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40020012',
                name: 'RETAIL SALES DISCOUNT RETURN 25%',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40020013',
                name: 'SALES TAX-OUTPUT RETAIL SALES',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '40020014',
                name: 'RETAIL SALES RETURN-CONTROL A/C',
                type: 'INCOME',
                isGroup: false,
              },
            ],
          },
        ],
      },
    ],
  },
];

export const otherIncomeChart: any[] = [
  {
    code: '5',
    name: 'OTHER INCOME',
    type: 'INCOME',
    isGroup: true,
    children: [
      {
        code: '50',
        name: 'OTHER OPERATING INCOME',
        type: 'INCOME',
        isGroup: true,
        children: [
          {
            code: '5001',
            name: 'OTHER OPERATING INCOME',
            type: 'INCOME',
            isGroup: true,
            children: [
              {
                code: '50010001',
                name: 'PROFIT ON BANK DEPOSITS',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '50010002',
                name: 'GAIN ON SALES OF PROPERTY AND EQUIPMENT',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '50010003',
                name: 'INTEREST INCOME',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '50010004',
                name: 'CAPITAL GAIN',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '50010005',
                name: 'EXCHANGE GAIN',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '50010006',
                name: 'DIVIDEND INCOME',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '50010007',
                name: 'UNREALIZED GAIN ON INVESTMENT',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '50010008',
                name: 'GAIN ON RENT CONCESSION',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '50010009',
                name: 'GRANT INCOME',
                type: 'INCOME',
                isGroup: false,
              },
              {
                code: '50010010',
                name: 'GAIN ON DISPOSAL OF ROU ASSET',
                type: 'INCOME',
                isGroup: false,
              },
            ],
          },
        ],
      },
    ],
  },
];

export const costOfSalesChart: any[] = [
  {
    code: '6',
    name: 'COST OF SALES',
    type: 'EXPENSE',
    isGroup: true,
    children: [
      {
        code: '60',
        name: 'COST OF SALES',
        type: 'EXPENSE',
        isGroup: true,
        children: [
          {
            code: '6001',
            name: 'OPENING STOCKS',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '60010001',
                name: 'OPENING STOCKS-STORES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '60010002',
                name: 'OPENING STOCKS-WAREHOUSE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '60010003',
                name: 'OPENING STOCK-SPARE PARTS',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '6002',
            name: 'PURCHASES',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '60020001',
                name: 'PURCHASES IMPORT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '60020002',
                name: 'PURCHASES LOCAL',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '60020003',
                name: 'PURCHASES CONSIGNMENT',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '6003',
            name: 'CLOSING STOCKS',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '60030001',
                name: 'CLOSING STOCKS-STORES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '60030002',
                name: 'CLOSING STOCKS-WAREHOUSE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '60030003',
                name: 'CLOSING STOCK-SPARE PARTS',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '6004',
            name: 'DIRECT COST',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '60040001',
                name: 'STOCK ADJUSTMENTS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '60040002',
                name: 'INVENTORY SHORT/EXCESS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '60040003',
                name: 'DEFECTIVE PRODUCTS',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
        ],
      },
    ],
  },
];

export const administrativeExpensesChart: any[] = [
  {
    code: '7',
    name: 'ADMINISTRATIVE EXPENSES',
    type: 'EXPENSE',
    isGroup: true,
    children: [
      {
        code: '70',
        name: 'ADMINISTRATIVE EXPENSES',
        type: 'EXPENSE',
        isGroup: true,
        children: [
          {
            code: '7001',
            name: 'SALARIES, ALLOWANCES AND BENEFITS',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70010001',
                name: 'SALARIES & ALLOWANCES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70010002',
                name: 'BONUS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70010003',
                name: 'INCENTIVES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70010004',
                name: 'MEDICAL REIMBURSEMENT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70010005',
                name: 'EOBI CONTRIBUTION',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70010006',
                name: 'SESSI CONTRIBUTION',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70010007',
                name: 'IESSI CONTRIBUTION',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70010008',
                name: 'PESSI CONTRIBUTION',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70010009',
                name: 'P.F. CONTRIBUTION',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70010010',
                name: 'GROUP LIFE INSURANCE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70010011',
                name: 'GROUP HEALTH INSURANCE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70010012',
                name: 'SALARIES-FINAL SETTLEMENT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70010013',
                name: 'LEAVE ENCASHMENT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70010014',
                name: 'LEAVE FARE ASSISTANCE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70010015',
                name: 'STAFF TRAINING EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70010016',
                name: 'COMPENSATION-CONTRACT STAFF',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7002',
            name: 'RENT RATE & TAXES',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70020001',
                name: 'RENT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70020002',
                name: 'SERVICE CHARGES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70020003',
                name: 'TAXES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70020005',
                name: 'SINDH SALES TAX ON RENT',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7003',
            name: 'COMMUNICATIONS',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70030001',
                name: 'TELEPHONE EXPENSES-PTCL',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70030002',
                name: 'MOBILE PHONE EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70030003',
                name: 'INTERNET EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70030004',
                name: 'POSTAGE',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7004',
            name: 'UTILITIES',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70040001',
                name: 'ELECTRICITY EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70040002',
                name: 'GENERATOR EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70040003',
                name: 'GAS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70040004',
                name: 'WATER CHARGES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70040005',
                name: 'AC CHARGES',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7005',
            name: 'OFFICE AMENITIES AND WELFARE',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70050001',
                name: 'OFFICE AMENITIES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70050002',
                name: 'DRINKING WATER',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70050003',
                name: 'STAFF BIRTHDAY',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70050004',
                name: 'LATE SITTING',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70050005',
                name: 'IFTAR ALLOWANCE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70050006',
                name: 'ENTERTAINMENT-OFFICE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70050007',
                name: 'ENTERTAINMENT-CLIENTS',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7006',
            name: 'PRINTING & STATIONERY',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70060001',
                name: 'PRINTING EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70060002',
                name: 'STATIONERY EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70060003',
                name: 'OFFICE SUPPLIES-PRINTER',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70060004',
                name: 'OFFICE SUPPLIES-COMPUTER',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70060005',
                name: 'OFFICE SUPPLIES-PAPERS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70060006',
                name: 'OFFICE SUPPLIES OTHERS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70060007',
                name: 'OFFICE SUPPLIES-HANGERS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70060008',
                name: 'OFFICE SUPPLIES-CARRY BAGS',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7007',
            name: 'VEHICLE RUNNING EXPENSES',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70070001',
                name: 'VEHICLE RUNNING-FUEL',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70070002',
                name: 'VEHICLE RUNNING-MAINTENANCE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70070003',
                name: 'PARKING CHARGES',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7008',
            name: 'TRAVELLING & CONVEYANCE',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70080001',
                name: 'AIR TICKET EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70080002',
                name: 'HOTEL EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70080003',
                name: 'TRAVELLING ALLOWANCE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70080004',
                name: 'CONVEYANCE EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70080005',
                name: 'TRAVELLING EXPENSES-OTHERS',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7009',
            name: 'LEGAL & PROFESSIONAL CHARGES',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70090001',
                name: 'RETAINERSHIP FEE-TAX',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70090002',
                name: 'RETAINERSHIP FEE-LAWYER',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70090003',
                name: 'RETAINERSHIP FEE-OTHERS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70090004',
                name: 'PROFESSIONAL CHARGES',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7010',
            name: 'SECURITY CHARGES',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70100001',
                name: 'SECURITY CHARGES',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7011',
            name: 'REPAIR & MAINTENANCE',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70110001',
                name: 'MAINTENANCE CHARGES-FIXED',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70110002',
                name: 'SHOP/BUILDING MAINTENANCE CHARGES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70110003',
                name: 'REPAIR & MAINTENANCE-GENERAL',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70110004',
                name: 'REPAIR & MAINTENANCE-EQUIPMENT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70110005',
                name: 'REPAIR & MAINTENANCE-OTHERS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70110006',
                name: 'COMPUTER SOFTWARE MAINTENANCE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70110007',
                name: 'ELECTRICAL CONTRACT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70110008',
                name: 'ELECTRICAL ACCESSORIES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70110009',
                name: 'JANITORIAL CHARGES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70110010',
                name: 'TOILETORIES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70110011',
                name: 'CONSUMABLES',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7012',
            name: 'INSURANCE EXPENSES',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70120001',
                name: 'INSURANCE EXPENSES-VEHICLES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70120002',
                name: 'INSURANCE-CASH IN SAFE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70120003',
                name: 'INSURANCE-CASH IN TRANSIT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70120004',
                name: 'INSURANCE-FIDELITY',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70120005',
                name: 'INSURANCE-ASSETS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70120006',
                name: 'INSURANCE-IN LAND TRANSIT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70120007',
                name: 'INSURANCE-STOCKS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70120008',
                name: 'INSURANCE-PLATE GLASS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70120009',
                name: 'INSURANCE-OTHERS',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7013',
            name: 'AUDITORS REMUNERATION',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70130001',
                name: 'AUDIT FEE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70130002',
                name: 'AUDITORS OUT OF POCKET EXPENSE',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7014',
            name: 'FEDERAL EXCISE DUTY',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70140001',
                name: 'FEDERAL EXCISE DUTY',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7015',
            name: 'DEPRECIATION',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70150001',
                name: 'DEPRECIATION LEASE HOLD IMPORVEMENTS-OWN',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70150002',
                name: 'DEPRECIATION FURNITURE, FIXTURES & FITTINGS-OWN',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70150003',
                name: 'DEPRECIATION OFFICE EQUIPMENTS-OWN',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70150004',
                name: 'DEPRECIATION COMPUTERS-OWN',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70150005',
                name: 'DEPRECIATIONMOTOR VEHICLES-OWN',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70150006',
                name: 'DEPRECIATION LEASE HOLD IMPORVEMENTS-LEASED',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70150007',
                name: 'DEPRECIATION FURNITURE, FIXTURES & FITTINGS-LEASED',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70150008',
                name: 'DEPRECIATION OFFICE EQUIPMENTS-LEASED',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70150021',
                name: 'DEPRECIATION COMPUTERS-LEASED',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70150022',
                name: 'DEPRECIATIONMOTOR VEHICLES-LEASED',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7016',
            name: 'DEPRECIATION-RIGHT OF USE ASSETS',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70160001',
                name: 'DEPRECIATION-ROUA',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7017',
            name: 'AMORTIZATION',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70170001',
                name: 'AMORTIZATION',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7018',
            name: 'ADVERTISEMENT AND PROMOTIONAL EXPENSES',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70180001',
                name: 'ADVERTISEMENT-NEWSPAPER & MAGAZINE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70180002',
                name: 'ADVERTISEMENT-BILLBOARD',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70180003',
                name: 'ADVERTISEMENT-PRINT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70180004',
                name: 'ADVERTISEMENT-MEDIA',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70180005',
                name: 'ADVERTISEMENT-SIGN/GRAPHICS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70180006',
                name: 'ADVERTISEMENT-FASHION & EVENTS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70180007',
                name: 'ADVERTISEMENT-OTHERS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70180008',
                name: 'PROMOTIONAL EXP-PRODUCT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70180009',
                name: 'PROMOTIONAL EXP-STAFF UNIFORMS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70180010',
                name: 'PROMOTIONAL EXP-GIVEAWAYS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70180011',
                name: 'PROMOTIONAL EXP-OTHERS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70180012',
                name: 'PROMOTIONAL EXP-DISCOUNT STORES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70180013',
                name: 'PROMOTIONAL EXP-CARRY BAGS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70180014',
                name: 'PROMOTIONAL EXP-MEGA SALES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70180015',
                name: 'PROMOTIONAL EXP-PROMOTION LEVY',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70180016',
                name: 'PROMOTIONAL EXP-MARKETING LEVY',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70180017',
                name: 'PROMOTIONAL EXP-RETAILER INCENTIVE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70180018',
                name: 'PROMOTIONAL EXP-PRINTED MATERIAL',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7019',
            name: 'DISTRIBUTION EXPENSES',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70190001',
                name: 'DISTRIBUTION AND LOGITITICS EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70190002',
                name: 'DISTRIBUTION AND LOGISTICS E-COMMERCE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70190003',
                name: 'CARTAGE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70190004',
                name: 'DISTRIBUTION EXPENSES-OTHERS',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7020',
            name: 'AFTER SALES',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70200001',
                name: 'SPARE PARTS CONSUMED',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70200002',
                name: 'TECHNICIAN SALARY & BENEFITS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70200003',
                name: 'DEPRECIATION-TOOLS & EQUIPMENT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70200004',
                name: 'SERVICE CENTRE ALLOCATED EXPNSES',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7021',
            name: 'BANK COMMISSIONS-MERCHANT',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70210001',
                name: 'BANK COMMISSIONS-MERCHANT',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7022',
            name: 'OTHERS',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70220001',
                name: 'OPERATING EXPENSES-MISC',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70220002',
                name: 'DOCUMENTATION CHARGES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70220003',
                name: 'PROFESSIONAL CHARGES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70220004',
                name: 'TAXES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70220005',
                name: 'STAMPS DUTY',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70220006',
                name: 'PROFESSIONAL TAX',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70220007',
                name: 'MOTOR VEHICLE TAX',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70220008',
                name: 'CENTRAL EXCISE DUTY',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70220009',
                name: 'SIGNAGE TAX',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70220010',
                name: 'TRADE LICENCE FEE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70220011',
                name: 'SHOPS & ESTABLISHMENT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70220012',
                name: 'CIVIL DEFENCE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70220013',
                name: 'CASH SHORTAGE & OVERAGES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70220014',
                name: 'INVENTORY SHORTAGES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70220015',
                name: 'NEWSPAPER',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70220016',
                name: 'BOOKS & PERIODICALS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70220017',
                name: 'FEE & SUBSCRIPTION',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70220018',
                name: 'BAD DEBTS EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70220019',
                name: 'EXPECTED CREDIT LOSE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70220020',
                name: 'IMPAIRMENT EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7023',
            name: 'DONATION',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70230001',
                name: 'DONATION',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7024',
            name: 'TAXATION-CURRENT',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70240001',
                name: 'TAXATION',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70240002',
                name: 'TURN OVER TAX',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '70240003',
                name: 'WWF',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '7025',
            name: 'LEVY',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '70250001',
                name: 'LEVY - MINIMUM TAX',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
        ],
      },
      {
        code: '80',
        name: 'SELLING AND DISTRIBUTION EXPNENSES',
        type: 'EXPENSE',
        isGroup: true,
        children: [
          {
            code: '8001',
            name: 'SALARIES, ALLOWANCES AND BENEFITS',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80010001',
                name: 'SALARIES & ALLOWANCES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80010002',
                name: 'BONUS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80010003',
                name: 'INCENTIVES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80010004',
                name: 'MEDICAL REIMBURSEMENT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80010005',
                name: 'EOBI CONTRIBUTION',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80010006',
                name: 'SESSI CONTRIBUTION',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80010007',
                name: 'IESSI CONTRIBUTION',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80010008',
                name: 'PESSI CONTRIBUTION',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80010009',
                name: 'P.F. CONTRIBUTION',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80010010',
                name: 'GROUP LIFE INSURANCE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80010011',
                name: 'GROUP HEALTH INSURANCE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80010012',
                name: 'SALARIES-FINAL SETTLEMENT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80010013',
                name: 'LEAVE ENCASHMENT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80010014',
                name: 'LEAVE FARE ASSISTANCE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80010015',
                name: 'STAFF TRAINING EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80010016',
                name: 'COMPENSATION-CONTRACT STAFF',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8002',
            name: 'RENT RATE & TAXES',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80020001',
                name: 'RENT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80020002',
                name: 'SERVICE CHARGES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80020003',
                name: 'TAXES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80020004',
                name: 'SINDH SALES TAX ON RENT',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8003',
            name: 'COMMUNICATIONS',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80030001',
                name: 'TELEPHONE EXPENSES-PTCL',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80030002',
                name: 'MOBILE PHONE EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80030003',
                name: 'INTERNET EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80030004',
                name: 'POSTAGE',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8004',
            name: 'UTILITIES',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80040001',
                name: 'ELECTRICITY EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80040002',
                name: 'GENERATOR EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80040003',
                name: 'GAS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80040004',
                name: 'WATER CHARGES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80040005',
                name: 'AC CHARGES',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8005',
            name: 'OFFICE AMENITIES AND WELFARE',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80050001',
                name: 'OFFICE AMENITIES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80050002',
                name: 'DRINKING WATER',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80050003',
                name: 'STAFF BIRTHDAY',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80050004',
                name: 'LATE SITTING',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80050005',
                name: 'IFTAR ALLOWANCE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80050006',
                name: 'ENTERTAINMENT-OFFICE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80050007',
                name: 'ENTERTAINMENT-CLIENTS',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8006',
            name: 'PRINTING & STATIONERY',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80060001',
                name: 'PRINTING EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80060002',
                name: 'STATIONERY EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80060003',
                name: 'OFFICE SUPPLIES-PRINTER',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80060004',
                name: 'OFFICE SUPPLIES-COMPUTER',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80060005',
                name: 'OFFICE SUPPLIES-PAPERS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80060006',
                name: 'OFFICE SUPPLIES OTHERS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80060007',
                name: 'OFFICE SUPPLIES-HANGERS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80060008',
                name: 'OFFICE SUPPLIES-CARRY BAGS',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8007',
            name: 'VEHICLE RUNNING EXPENSES',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80070001',
                name: 'VEHICLE RUNNING-FUEL',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80070002',
                name: 'VEHICLE RUNNING-MAINTENANCE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80070003',
                name: 'PARKING CHARGES',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8008',
            name: 'TRAVELLING & CONVEYANCE',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80080001',
                name: 'AIR TICKET EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80080002',
                name: 'HOTEL EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80080003',
                name: 'TRAVELLING ALLOWANCE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80080004',
                name: 'CONVEYANCE EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80080005',
                name: 'TRAVELLING EXPENSES-OTHERS',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8009',
            name: 'LEGAL & PROFESSIONAL CHARGES',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80090001',
                name: 'RETAINERSHIP FEE-TAX',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80090002',
                name: 'RETAINERSHIP FEE-LAWYER',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80090003',
                name: 'RETAINERSHIP FEE-OTHERS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80090004',
                name: 'PROFESSIONAL CHARGES',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8010',
            name: 'SECURITY CHARGES',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80100001',
                name: 'SECURITY CHARGES',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8011',
            name: 'REPAIR AND MAINTENANCE',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80110001',
                name: 'SHOP/BUILDING MAINTENANCE CHARGES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80110002',
                name: 'REPAIR & MAINTENANCE-GENERAL',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80110003',
                name: 'REPAIR & MAINTENANCE-EQUIPMENT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80110004',
                name: 'REPAIR & MAINTENANCE-OTHERS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80110005',
                name: 'COMPUTER SOFTWARE MAINTENANCE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80110006',
                name: 'ELECTRICAL CONTRACT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80110007',
                name: 'ELECTRICAL ACCESSORIES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80110008',
                name: 'JANITORIAL CHARGES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80110009',
                name: 'TOILETORIES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80110010',
                name: 'CONSUMABLES',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8012',
            name: 'INSURANCE EXPENSES',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80120001',
                name: 'INSURANCE EXPENSES-VEHICLES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80120002',
                name: 'INSURANCE-CASH IN SAFE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80120003',
                name: 'INSURANCE-CASH IN TRANSIT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80120004',
                name: 'INSURANCE-FIDELITY',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80120005',
                name: 'INSURANCE-ASSETS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80120006',
                name: 'INSURANCE-IN LAND TRANSIT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80120007',
                name: 'INSURANCE-STOCKS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80120008',
                name: 'INSURANCE-PLATE GLASS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80120009',
                name: 'INSURANCE-OTHERS',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8013',
            name: 'AUDITORS REMUNERATION',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80130001',
                name: 'AUDIT FEE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80130002',
                name: 'AUDITORS OUT OF POCKET EXPENSE',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8014',
            name: 'FEDERAL EXCISE DUTY',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80140001',
                name: 'FEDERAL EXCISE DUTY',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8015',
            name: 'DEPRECIATION',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80150001',
                name: 'DEPRECIATION LEASE HOLD IMPORVEMENTS-OWN',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80150002',
                name: 'DEPRECIATION FURNITURE, FIXTURES & FITTINGS-OWN',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80150003',
                name: 'DEPRECIATION OFFICE EQUIPMENTS-OWN',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80150004',
                name: 'DEPRECIATION COMPUTERS-OWN',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80150005',
                name: 'DEPRECIATIONMOTOR VEHICLES-OWN',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80150006',
                name: 'DEPRECIATION LEASE HOLD IMPORVEMENTS-LEASED',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80150007',
                name: 'DEPRECIATION FURNITURE, FIXTURES & FITTINGS-LEASED',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80150008',
                name: 'DEPRECIATION OFFICE EQUIPMENTS-LEASED',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80150021',
                name: 'DEPRECIATION COMPUTERS-LEASED',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80150022',
                name: 'DEPRECIATIONMOTOR VEHICLES-LEASED',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8016',
            name: 'DEPRECIATION-RIGHT OF USE ASSETS',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80160001',
                name: 'DEPRECIATION-ROUA',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8017',
            name: 'AMORTIZATION',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80170001',
                name: 'AMORTIZATION',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8018',
            name: 'ADVERTISEMENT AND PROMOTIONAL EXPENSES',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80180001',
                name: 'ADVERTISEMENT-NEWSPAPER & MAGAZINE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80180002',
                name: 'ADVERTISEMENT-BILLBOARD',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80180003',
                name: 'ADVERTISEMENT-PRINT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80180004',
                name: 'ADVERTISEMENT-MEDIA',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80180005',
                name: 'ADVERTISEMENT-SIGN/GRAPHICS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80180006',
                name: 'ADVERTISEMENT-FASHION & EVENTS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80180007',
                name: 'ADVERTISEMENT-OTHERS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80180008',
                name: 'PROMOTIONAL EXP-PRODUCT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80180009',
                name: 'PROMOTIONAL EXP-STAFF UNIFORMS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80180010',
                name: 'PROMOTIONAL EXP-GIVEAWAYS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80180011',
                name: 'PROMOTIONAL EXP-OTHERS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80180012',
                name: 'PROMOTIONAL EXP-DISCOUNT STORES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80180013',
                name: 'PROMOTIONAL EXP-CARRY BAGS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80180014',
                name: 'PROMOTIONAL EXP-MEGA SALES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80180015',
                name: 'PROMOTIONAL EXP-PROMOTION LEVY',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80180016',
                name: 'PROMOTIONAL EXP-MARKETING LEVY',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80180017',
                name: 'PROMOTIONAL EXP-RETAILER INCENTIVE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80180018',
                name: 'PROMOTIONAL EXP-PRINTED MATERIAL',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8019',
            name: 'DISTRIBUTION EXPENSES',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80190001',
                name: 'DISTRIBUTION AND LOGITITICS EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80190002',
                name: 'DISTRIBUTION AND LOGISTICS E-COMMERCE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80190003',
                name: 'CARTAGE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80190004',
                name: 'DISTRIBUTION EXPENSES-OTHERS',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8020',
            name: 'SERVICE CENTRE',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80200001',
                name: 'SPARE PARTS CONSUMED',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80200002',
                name: 'TECHNICIAN SALARY & BENEFITS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80200003',
                name: 'DEPRECIATION-TOOLS & EQUIPMENT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80200004',
                name: 'SERVICE CENTRE ALLOCATED EXPNSES',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8021',
            name: 'BANK COMMISSIONS-MERCHANT',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80210001',
                name: 'BANK COMMISSIONS-MERCHANT',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8022',
            name: 'OTHERS',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80220001',
                name: 'OPERATING EXPENSES-MISC',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80220002',
                name: 'DOCUMENTATION CHARGES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80220003',
                name: 'PROFESSIONAL CHARGES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80220004',
                name: 'TAXES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80220005',
                name: 'STAMPS DUTY',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80220006',
                name: 'PROFESSIONAL TAX',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80220007',
                name: 'MOTOR VEHICLE TAX',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80220008',
                name: 'CENTRAL EXCISE DUTY',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80220009',
                name: 'SIGNAGE TAX',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80220010',
                name: 'TRADE LICENCE FEE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80220011',
                name: 'SHOPS & ESTABLISHMENT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80220012',
                name: 'CIVIL DEFENCE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80220013',
                name: 'CASH SHORTAGE & OVERAGES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80220014',
                name: 'INVENTORY SHORTAGES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80220015',
                name: 'NEWSPAPER',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80220016',
                name: 'BOOKS & PERIODICALS',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80220017',
                name: 'FEE & SUBSCRIPTION',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80220018',
                name: 'BAD DEBTS EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80220019',
                name: 'EXPECTED CREDIT LOSE',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80220020',
                name: 'IMPAIRMENT EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8023',
            name: 'DONATION',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80230001',
                name: 'DONATION',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8024',
            name: 'TAXATION-CURRENT',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80240001',
                name: 'TAXATION',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80240002',
                name: 'TURN OVER TAX',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '80240003',
                name: 'WWF',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '8025',
            name: 'LEVY',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '80250001',
                name: 'LEVY - MINIMUM TAX',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
        ],
      },
      {
        code: '90',
        name: 'FINANCIAL CHARGES',
        type: 'EXPENSE',
        isGroup: true,
        children: [
          {
            code: '9001',
            name: 'FINANCIAL CHARGES-BANKS',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '90010001',
                name: 'BANK CHARGES & COMMISSION',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '90010002',
                name: 'MARK UP ON LOAN',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '90010003',
                name: 'INTEREST EXPENSES',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '9002',
            name: 'FINANCIAL CHARGES-LEASE',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '90020001',
                name: 'LEASE FINANCIAL CHARGES',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '90020002',
                name: 'INTEREST ON LEASE-ROU ASSETS',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
          {
            code: '9003',
            name: 'BANK CHARGES-IMPORT',
            type: 'EXPENSE',
            isGroup: true,
            children: [
              {
                code: '90030001',
                name: 'BANK CHARGES-IMPORT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '90030002',
                name: 'CONFIRMATION CHARGES IMPORT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '90030003',
                name: 'EXCHANGE LOSS IMPORT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '90030004',
                name: 'FOREIGN BANK CHARGES IMPORT',
                type: 'EXPENSE',
                isGroup: false,
              },
              {
                code: '90030005',
                name: 'REIMBURSEMENT CHARGES IMPORT',
                type: 'EXPENSE',
                isGroup: false,
              },
            ],
          },
        ],
      },
    ],
  },
];

export const otherOperating: any[] = [
  {
    code: '99',
    name: 'OTHER EXPENSES',
    type: 'EXPENSE',
    isGroup: true,
    children: [
      {
        code: '9901',
        name: 'OTHER OPERATING EXPENSES',
        type: 'EXPENSE',
        isGroup: true,
        children: [
          {
            code: '99010001',
            name: 'LOSS ON SALES OF PROPERTY AND EQUIPMENT',
            type: 'EXPENSE',
            isGroup: false,
          },
          {
            code: '99010002',
            name: 'CAPITAL LOSS',
            type: 'EXPENSE',
            isGroup: false,
          },
          {
            code: '99010003',
            name: 'EXCHANGE LOSS',
            type: 'EXPENSE',
            isGroup: false,
          },
          {
            code: '99010004',
            name: 'UNREALIZED LOSS ON INVESTMENT',
            type: 'EXPENSE',
            isGroup: false,
          },
          {
            code: '99010005',
            name: 'LOSS ON RENT CONCESSION',
            type: 'EXPENSE',
            isGroup: false,
          },
          {
            code: '99010006',
            name: 'LOSS ON DISPOSAL OF ROU ASSETS',
            type: 'EXPENSE',
            isGroup: false,
          },
          {
            code: '99010007',
            name: 'LOSS ON REASSESMENT OF LEASE LIABILITY',
            type: 'EXPENSE',
            isGroup: false,
          },
          {
            code: '99010008',
            name: 'LOSS ON RENT CONCESSION',
            type: 'EXPENSE',
            isGroup: false,
          },
        ],
      },
    ],
  },
];

function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!masterKeyString || masterKeyString.length < 32) {
    throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
  }
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const algorithm = 'aes-256-gcm';

  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(algorithm, masterKey, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

async function seedAccounts(
  prisma: PrismaClient,
  accounts: any[],
  parentId: string | null = null,
) {
  for (const account of accounts) {
    const { children, ...data } = account;

    // console.log(`Processing ${data.code} - ${data.name}`);

    let upserted;
    const existing = await prisma.chartOfAccount.findFirst({
      where: { code: data.code },
    });

    if (existing) {
      upserted = await prisma.chartOfAccount.update({
        where: { id: existing.id },
        data: {
          name: data.name,
          type: data.type as AccountType,
          isGroup: data.isGroup,
          parentId: parentId,
          isActive: true,
        },
      });
    } else {
      upserted = await prisma.chartOfAccount.create({
        data: {
          code: data.code,
          name: data.name,
          type: data.type as AccountType,
          isGroup: data.isGroup,
          parentId: parentId,
          isActive: true,
        },
      });
    }

    if (children && children.length > 0) {
      await seedAccounts(prisma, children, upserted.id);
    }
  }
}

async function main() {
  console.log('🚀 Starting Multi-Tenant Chart of Accounts Seeding...');

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
      if (specificTenant) {
        console.log(
          `ℹ️ No active company found with database name: ${specificTenant}`,
        );
      } else {
        console.log('ℹ️ No active companies found in Master DB.');
      }
      return;
    }

    if (specificTenant) {
      console.log(
        `📡 Targeting tenant: ${specificTenant}. Seeding chart of accounts...`,
      );
    } else {
      console.log(
        `📡 Found ${companies.length} active companies. Syncing chart of accounts...`,
      );
    }

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
          } catch (e) {
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
          console.log(`   Seeding Equity Chart...`);
          await seedAccounts(tenantPrisma, equityChart);

          console.log(`   Seeding Liabilities Chart...`);
          await seedAccounts(tenantPrisma, liabilitiesChart);

          console.log(`   Seeding Assets Chart...`);
          await seedAccounts(tenantPrisma, assetsChart);

          console.log(`   Seeding Revenue Chart...`);
          await seedAccounts(tenantPrisma, revenueChart);

          console.log(`   Seeding Other Income Chart...`);
          await seedAccounts(tenantPrisma, otherIncomeChart);

          console.log(`   Seeding Cost of Sales Chart...`);
          await seedAccounts(tenantPrisma, costOfSalesChart);

          console.log(`   Seeding Administrative Expenses Chart...`);
          await seedAccounts(tenantPrisma, administrativeExpensesChart);

          console.log(`   Seeding Other Operating Expenses Chart...`);
          await seedAccounts(tenantPrisma, otherOperating);

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
