// @ts-nocheck
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../src/database/prisma.service';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';
import { getFiscalYearLabel, generateNextFolioNumber } from '../src/common/utils/voucher-number.util';

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

/**
 * Robustly extracts RSRV numbers from text.
 * Handles formats like:
 * - RSRV 522
 * - RSRV # 965
 * - RSRV#522
 * - RSRV $# 1383 (typos with symbols)
 * - RSRV NO. 522
 * - RS-RV 522 / RS_RV 522
 * - RSRV-522 / RSRV:522 / RSRV.522
 */
function extractRsrvNumber(text?: string | null, rvNo?: string | null): number | null {
  // 1. Check manual description / remarks / narrations
  if (text) {
    // If text contains a fully formatted standard RSRV (e.g. RSRV-26-27-01017), extract sequence after FY
    const standardFormatMatch = text.match(/(?:RS[-_\.\s]?RV|RSRV)-\d{2}-\d{2}-(\d+)/i);
    if (standardFormatMatch && standardFormatMatch[1]) {
      const num = parseInt(standardFormatMatch[1], 10);
      if (!isNaN(num) && num > 0) return num;
    }

    // Otherwise, match manual pattern: RSRV followed by optional non-digits and then digits
    // Negative lookahead prevents matching the '26' in 'RSRV-26-27-'
    const manualMatch = text.match(/(?:RS[-_\.\s]?RV|RSRV)(?!\s*-\s*\d{2}\s*-\s*\d{2})[^0-9\n\r]*?(\d+)/i);
    if (manualMatch && manualMatch[1]) {
      let num = parseInt(manualMatch[1], 10);
      // Correct known user typo where an extra digit was typed (e.g. 11432 on 2026-08-06 -> 1143)
      if (num === 11432) {
        num = 1143;
      }
      if (!isNaN(num) && num > 0) return num;
    }
  }

  // 2. If no manual RSRV in description/remarks, but rvNo itself is already an RSRV (e.g. RSRV-26-27-01017)
  if (rvNo) {
    const rvMatch = rvNo.match(/(?:RS[-_\.\s]?RV|RSRV)-\d{2}-\d{2}-(\d+)/i);
    if (rvMatch && rvMatch[1]) {
      const num = parseInt(rvMatch[1], 10);
      if (!isNaN(num) && num > 0) return num;
    }
    const legacyMatch = rvNo.match(/(?:RS[-_\.\s]?RV|RSRV)-(\d+)/i);
    if (legacyMatch && legacyMatch[1]) {
      const num = parseInt(legacyMatch[1], 10);
      if (!isNaN(num) && num > 0) return num;
    }
  }

  return null;
}

interface MigrationAuditReport {
  dbName: string;
  isDryRun: boolean;
  generatedAt: string;
  cutoffDate: string;
  summary: {
    totalVouchersBeforeCutoff: number;
    septemberMigratedCount: number;
    septemberAlreadyRsrvCount: number;
    septemberDuplicateCount: number;
    septemberMissingDescCount: number;
    septemberUnparseableCount: number;
    highestSeptemberNumber: number;
    octoberResequencedCount: number;
    octoberNewRangeStart: number;
    octoberNewRangeEnd: number;
    missingSequenceCount: number;
  };
  missingSequenceNumbers: number[];
  duplicates: Array<{
    extractedNum: number;
    vouchers: Array<{
      id: string;
      originalRvNo: string;
      assignedRvNo: string;
      rvDate: string;
      amount: string | number;
      description: string | null;
    }>;
  }>;
  unparseableRsrvVouchers: Array<{
    id: string;
    rvNo: string;
    rvDate: string;
    amount: string | number;
    description: string | null;
    remarks: string | null;
  }>;
  missingRsrvDescriptionVouchers: Array<{
    id: string;
    rvNo: string;
    type: string;
    rvDate: string;
    amount: string | number;
    description: string | null;
    remarks: string | null;
  }>;
  octoberResequencedPlan: Array<{
    id: string;
    originalRvNo: string;
    newRvNo: string;
    rvDate: string;
    description: string | null;
  }>;
}

async function migrateRsrvVouchers(
  prisma: any,
  dbName: string,
  isDryRun: boolean = false,
  cutoffDate: Date = new Date('2026-09-30T23:59:59.999Z'),
) {
  const modeHeader = isDryRun ? '🔍 [DRY RUN MODE - AUDIT ONLY]' : '🚀 [LIVE MIGRATION MODE]';
  console.log(`\n=====================================================`);
  console.log(`${modeHeader} DB: "${dbName}"`);
  console.log(`Cutoff Date: ${cutoffDate.toISOString().slice(0, 10)} (Vouchers on/before this date are September batch)`);
  console.log(`=====================================================\n`);

  // =========================================================================
  // STEP 1: Query & Categorize all vouchers on or before September 30
  // =========================================================================
  console.log(`⏳ Step 1/4: Analyzing vouchers on or before ${cutoffDate.toISOString().slice(0, 10)}...`);

  const septVouchers = await prisma.receiptVoucher.findMany({
    where: {
      rvDate: { lte: cutoffDate },
    },
    include: {
      details: true,
    },
    orderBy: [{ rvDate: 'asc' }, { createdAt: 'asc' }, { rvNo: 'asc' }],
  });

  console.log(`   Found ${septVouchers.length} vouchers on or before cutoff date.`);

  const matchedSeptVouchers: Array<{
    voucher: any;
    extractedNum: number;
    fyLabel: string;
    combinedText: string;
  }> = [];

  const unparseableRsrv: any[] = [];
  const missingRsrvDesc: any[] = [];

  for (const rv of septVouchers) {
    const lineNarrations = rv.details?.map((d: any) => d.narration).filter(Boolean).join(' ') || '';
    const manualText = `${rv.remarks || ''} ${rv.description || ''} ${rv.refBillNo || ''} ${lineNarrations}`.trim();

    const mentionsRsrv =
      /(?:RS[-_\.\s]?RV|RSRV)/i.test(manualText) ||
      rv.type === 'rs_rv' ||
      rv.rvNo.startsWith('RSRV-') ||
      rv.rvNo.startsWith('RS-RV-');

    if (mentionsRsrv) {
      const extractedNum = extractRsrvNumber(manualText, rv.rvNo);
      if (extractedNum !== null) {
        const fyLabel = getFiscalYearLabel(rv.rvDate || rv.createdAt);
        matchedSeptVouchers.push({
          voucher: rv,
          extractedNum,
          fyLabel,
          combinedText: manualText,
        });
      } else {
        unparseableRsrv.push({
          id: rv.id,
          rvNo: rv.rvNo,
          rvDate: rv.rvDate ? new Date(rv.rvDate).toISOString().slice(0, 10) : 'N/A',
          amount: rv.debitAmount?.toString() || '0.00',
          description: rv.description,
          remarks: rv.remarks,
        });
      }
    } else {
      missingRsrvDesc.push({
        id: rv.id,
        rvNo: rv.rvNo,
        type: rv.type,
        rvDate: rv.rvDate ? new Date(rv.rvDate).toISOString().slice(0, 10) : 'N/A',
        amount: rv.debitAmount?.toString() || '0.00',
        description: rv.description,
        remarks: rv.remarks,
      });
    }
  }

  // Detect duplicate RSRV numbers in September vouchers
  const numToVouchersMap = new Map<number, typeof matchedSeptVouchers>();
  for (const item of matchedSeptVouchers) {
    if (!numToVouchersMap.has(item.extractedNum)) {
      numToVouchersMap.set(item.extractedNum, []);
    }
    numToVouchersMap.get(item.extractedNum)!.push(item);
  }

  const duplicatesReport: MigrationAuditReport['duplicates'] = [];
  const assignedSeptemberNumbers = new Set<string>();

  // Determine highest September RSRV number
  let maxSeptNumber = 0;
  let minSeptNumber = Number.MAX_SAFE_INTEGER;

  for (const item of matchedSeptVouchers) {
    if (item.extractedNum > maxSeptNumber) maxSeptNumber = item.extractedNum;
    if (item.extractedNum < minSeptNumber) minSeptNumber = item.extractedNum;
  }
  if (minSeptNumber === Number.MAX_SAFE_INTEGER) minSeptNumber = 1;

  // Gap analysis for September sequence
  const uniqueNums = new Set(matchedSeptVouchers.map((m) => m.extractedNum));
  const missingSequenceNumbers: number[] = [];
  for (let n = minSeptNumber; n <= maxSeptNumber; n++) {
    if (!uniqueNums.has(n)) {
      missingSequenceNumbers.push(n);
    }
  }

  console.log(`   RSRV Range in September : RSRV # ${minSeptNumber} ---> RSRV # ${maxSeptNumber}`);
  console.log(`   Matched September RSRVs : ${matchedSeptVouchers.length} vouchers`);
  console.log(`   Unparseable RSRVs       : ${unparseableRsrv.length} vouchers`);
  console.log(`   Missing RSRV in Desc    : ${missingRsrvDesc.length} vouchers (e.g. BR# bank receipts)`);
  console.log(`   Missing Sequence Gaps   : ${missingSequenceNumbers.length} numbers\n`);

  // =========================================================================
  // STEP 2: Query & Plan Re-sequencing for October RSRVs
  // =========================================================================
  console.log(`⏳ Step 2/4: Planning re-sequencing for October RSRV vouchers...`);

  const octRsrvVouchers = await prisma.receiptVoucher.findMany({
    where: {
      rvDate: { gt: cutoffDate },
      OR: [
        { type: 'rs_rv' },
        { rvNo: { startsWith: 'RSRV-' } },
        { rvNo: { startsWith: 'RS-RV-' } },
      ],
    },
    orderBy: [{ rvDate: 'asc' }, { createdAt: 'asc' }, { rvNo: 'asc' }],
  });

  console.log(`   Found ${octRsrvVouchers.length} October RSRV vouchers to re-sequence.`);

  let octNextSeq = maxSeptNumber + 1;
  const octStartSeq = octNextSeq;
  const octoberResequencedPlan: MigrationAuditReport['octoberResequencedPlan'] = [];

  for (const octVoucher of octRsrvVouchers) {
    const fyLabel = getFiscalYearLabel(octVoucher.rvDate || octVoucher.createdAt);
    const newRvNo = `RSRV-${fyLabel}-${octNextSeq.toString().padStart(5, '0')}`;
    octoberResequencedPlan.push({
      id: octVoucher.id,
      originalRvNo: octVoucher.rvNo,
      newRvNo,
      rvDate: octVoucher.rvDate ? new Date(octVoucher.rvDate).toISOString().slice(0, 10) : 'N/A',
      description: octVoucher.description,
    });
    octNextSeq++;
  }
  const octEndSeq = octNextSeq - 1;

  if (octRsrvVouchers.length > 0) {
    console.log(`   October New Sequence    : RSRV # ${octStartSeq} ---> RSRV # ${octEndSeq}`);
  }

  // =========================================================================
  // STEP 3: Execute Resequencing & Migration (or Preview in Dry Run)
  // =========================================================================
  if (isDryRun) {
    console.log(`\n🔍 [DRY RUN] Simulating changes without touching database...`);
  } else {
    console.log(`\n🚀 [LIVE EXECUTION] Applying changes to database...`);

    // --- PHASE 3A: Move October vouchers to temporary numbers (if needed) ---
    const octPlansToUpdate = octoberResequencedPlan.filter((p) => p.originalRvNo !== p.newRvNo);
    if (octPlansToUpdate.length > 0) {
      console.log(`\n   Phase 3A: Safely moving ${octPlansToUpdate.length} October vouchers to temporary IDs...`);
      for (let i = 0; i < octPlansToUpdate.length; i++) {
        const plan = octPlansToUpdate[i];
        const tempRvNo = `TEMP-RSRV-${plan.id.slice(0, 8)}-${(i + 1).toString().padStart(5, '0')}`;
        await prisma.receiptVoucher.update({
          where: { id: plan.id },
          data: { rvNo: tempRvNo },
        });
      }
      console.log(`   ✅ October vouchers moved to temporary IDs to free up the 01000-03000 number space.`);

      // --- PHASE 3B: Assign final sequential numbers to October vouchers ---
      console.log(`   Phase 3B: Assigning final sequential numbers to October vouchers (${octStartSeq}..${octEndSeq})...`);
      for (const plan of octPlansToUpdate) {
        await prisma.receiptVoucher.update({
          where: { id: plan.id },
          data: {
            type: 'rs_rv',
            rvNo: plan.newRvNo,
          },
        });
      }
      console.log(`   ✅ October vouchers successfully re-sequenced!`);
    } else {
      console.log(`   ℹ️ October vouchers already have sequential numbers (${octStartSeq}..${octEndSeq}). Skipping October rename.`);
    }
  }

  // --- PREPARE SEPTEMBER MIGRATION PLAN ---
  console.log(`\n   Phase 3C: Planning September candidate voucher updates...`);
  let septMigratedCount = 0;
  let septAlreadyRsrvCount = 0;
  let septDuplicateCount = 0;

  const septUpdatePlans: Array<{
    voucher: any;
    targetRvNo: string;
  }> = [];

  for (const [extractedNum, list] of numToVouchersMap.entries()) {
    if (list.length > 1) {
      septDuplicateCount += list.length;
      const dupEntry = {
        extractedNum,
        vouchers: [] as any[],
      };

      for (let idx = 0; idx < list.length; idx++) {
        const item = list[idx];
        const v = item.voucher;
        // The first gets standard format, subsequent get -DUP suffix to maintain @unique constraint
        const targetRvNo =
          idx === 0
            ? `RSRV-${item.fyLabel}-${extractedNum.toString().padStart(5, '0')}`
            : `RSRV-${item.fyLabel}-${extractedNum.toString().padStart(5, '0')}-DUP${idx}`;

        dupEntry.vouchers.push({
          id: v.id,
          originalRvNo: v.rvNo,
          assignedRvNo: targetRvNo,
          rvDate: v.rvDate ? new Date(v.rvDate).toISOString().slice(0, 10) : 'N/A',
          amount: v.debitAmount?.toString() || '0.00',
          description: v.description,
        });

        if (v.type === 'rs_rv' && v.rvNo === targetRvNo) {
          septAlreadyRsrvCount++;
        } else {
          septUpdatePlans.push({ voucher: v, targetRvNo });
          septMigratedCount++;
        }
      }
      duplicatesReport.push(dupEntry);
    } else {
      // Single unique match
      const item = list[0];
      const v = item.voucher;
      const targetRvNo = `RSRV-${item.fyLabel}-${extractedNum.toString().padStart(5, '0')}`;

      if (v.type === 'rs_rv' && v.rvNo === targetRvNo) {
        septAlreadyRsrvCount++;
      } else {
        septUpdatePlans.push({ voucher: v, targetRvNo });
        septMigratedCount++;
      }
    }
  }

  // --- EXECUTE SEPTEMBER MIGRATION (TWO-PASS) ---
  if (!isDryRun) {
    // Pass 1: Temporarily rename all vouchers to be updated so none hold targetRvNo
    console.log(`   Phase 3C-1: Moving ${septUpdatePlans.length} September vouchers to temporary IDs to prevent unique constraint collisions...`);
    for (let i = 0; i < septUpdatePlans.length; i++) {
      const plan = septUpdatePlans[i];
      const tempRvNo = `TEMP-SEPT-${plan.voucher.id.slice(0, 8)}-${(i + 1).toString().padStart(5, '0')}`;
      await prisma.receiptVoucher.update({
        where: { id: plan.voucher.id },
        data: { rvNo: tempRvNo },
      });
    }
    console.log(`   ✅ September vouchers safely moved to temporary IDs.`);

    // Pass 2: Assign final targetRvNo, set type='rs_rv', and generate folio
    console.log(`   Phase 3C-2: Assigning final RSRV numbers and types to September vouchers...`);
    for (let i = 0; i < septUpdatePlans.length; i++) {
      const plan = septUpdatePlans[i];
      const v = plan.voucher;
      let folio = v.folio;
      if (!folio) {
        folio = await generateNextFolioNumber(prisma, v.rvDate || v.createdAt);
      }
      await prisma.receiptVoucher.update({
        where: { id: v.id },
        data: {
          type: 'rs_rv',
          rvNo: plan.targetRvNo,
          folio,
        },
      });
      if ((i + 1) % 500 === 0 || i === septUpdatePlans.length - 1) {
        console.log(`      Updated ${i + 1}/${septUpdatePlans.length} vouchers...`);
      }
    }
    console.log(`   ✅ All September vouchers successfully updated!`);
  }

  console.log(`\n   ✅ September Migration Complete:`);
  console.log(`      - Newly Migrated / Updated: ${septMigratedCount}`);
  console.log(`      - Already Correct RSRVs   : ${septAlreadyRsrvCount}`);
  console.log(`      - Duplicate Vouchers Handled: ${septDuplicateCount}`);

  // =========================================================================
  // STEP 4: Build & Save Audit Report
  // =========================================================================
  const auditReport: MigrationAuditReport = {
    dbName,
    isDryRun,
    generatedAt: new Date().toISOString(),
    cutoffDate: cutoffDate.toISOString(),
    summary: {
      totalVouchersBeforeCutoff: septVouchers.length,
      septemberMigratedCount: septMigratedCount,
      septemberAlreadyRsrvCount: septAlreadyRsrvCount,
      septemberDuplicateCount: septDuplicateCount,
      septemberMissingDescCount: missingRsrvDesc.length,
      septemberUnparseableCount: unparseableRsrv.length,
      highestSeptemberNumber: maxSeptNumber,
      octoberResequencedCount: octRsrvVouchers.length,
      octoberNewRangeStart: octStartSeq,
      octoberNewRangeEnd: octEndSeq,
      missingSequenceCount: missingSequenceNumbers.length,
    },
    missingSequenceNumbers,
    duplicates: duplicatesReport,
    unparseableRsrvVouchers: unparseableRsrv,
    missingRsrvDescriptionVouchers: missingRsrvDesc,
    octoberResequencedPlan,
  };

  // Ensure reports directory exists
  const reportsDir = path.join(__dirname, 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const jsonPath = path.join(reportsDir, `rsrv-audit-${dbName}-${timestamp}.json`);
  const mdPath = path.join(reportsDir, `rsrv-audit-${dbName}-${timestamp}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(auditReport, null, 2), 'utf-8');

  // Generate Markdown summary file
  let mdContent = `# RSRV Voucher Migration & Audit Report
**Database:** \`${dbName}\`  
**Execution Mode:** \`${isDryRun ? 'DRY-RUN (Simulated)' : 'LIVE EXECUTION'}\`  
**Generated At:** \`${auditReport.generatedAt}\`  
**September Cutoff Date:** \`${cutoffDate.toISOString().slice(0, 10)}\`  

---

## 1. Executive Summary

| Metric | Count / Range |
| :--- | :--- |
| **Total Vouchers on/before Cutoff** | \`${septVouchers.length}\` |
| **September RSRVs Migrated / Updated** | \`${septMigratedCount}\` |
| **September RSRVs Already Correct** | \`${septAlreadyRsrvCount}\` |
| **September RSRV Sequence Range** | \`RSRV # ${minSeptNumber}  -->  RSRV # ${maxSeptNumber}\` |
| **Highest September Sequence Number** | \`${maxSeptNumber}\` |
| **October RSRVs Re-sequenced** | \`${octRsrvVouchers.length}\` |
| **October New Sequence Range** | \`RSRV # ${octStartSeq}  -->  RSRV # ${octEndSeq}\` |
| **Missing Sequence Gaps in September** | \`${missingSequenceNumbers.length}\` |
| **Vouchers with Duplicate RSRV Numbers** | \`${septDuplicateCount}\` |
| **Vouchers with Unparseable RSRV Text** | \`${unparseableRsrv.length}\` |
| **Vouchers with No RSRV Description (Standard BRVs)** | \`${missingRsrvDesc.length}\` |

---

## 2. Sequence Gaps in September (1 to ${maxSeptNumber})
${
  missingSequenceNumbers.length === 0
    ? '✅ No missing sequence numbers! The 1 to ' + maxSeptNumber + ' sequence is completely continuous.'
    : `⚠️ Found **${missingSequenceNumbers.length} missing sequence numbers** in the September range:\n\n` +
      missingSequenceNumbers.map((n) => `\`#${n}\``).join(', ')
}

---

## 3. Duplicate RSRV Numbers in September (${duplicatesReport.length} sets, ${septDuplicateCount} total vouchers)
${
  duplicatesReport.length === 0
    ? '✅ No duplicate RSRV numbers found.'
    : duplicatesReport
        .map(
          (d) => `### RSRV #${d.extractedNum}
| Voucher ID | Original rvNo | Assigned rvNo | Date | Amount | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
` +
            d.vouchers
              .map(
                (v) =>
                  `| \`${v.id.slice(0, 8)}...\` | \`${v.originalRvNo}\` | \`${v.assignedRvNo}\` | ${v.rvDate} | ${v.amount} | ${v.description || 'N/A'} |`,
              )
              .join('\n'),
        )
        .join('\n\n')
}

---

## 4. Vouchers Mentioning RSRV But Unparseable (${unparseableRsrv.length} vouchers)
${
  unparseableRsrv.length === 0
    ? '✅ All vouchers mentioning RSRV were successfully parsed!'
    : `| Voucher ID | Current rvNo | Date | Amount | Description / Remarks |
| :--- | :--- | :--- | :--- | :--- |
` +
      unparseableRsrv
        .map(
          (v) =>
            `| \`${v.id.slice(0, 8)}...\` | \`${v.rvNo}\` | ${v.rvDate} | ${v.amount} | ${v.description || v.remarks || 'N/A'} |`,
        )
        .join('\n')
}

---

## 5. September Vouchers Without RSRV in Description (Sample first 50 of ${missingRsrvDesc.length})
These vouchers on/before September 30 did not have "RSRV" in their description or remarks (standard bank/cash receipts):

| Voucher ID | Current rvNo | Type | Date | Amount | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
${missingRsrvDesc
  .slice(0, 50)
  .map(
    (v) =>
      `| \`${v.id.slice(0, 8)}...\` | \`${v.rvNo}\` | \`${v.type}\` | ${v.rvDate} | ${v.amount} | ${v.description || 'N/A'} |`,
  )
  .join('\n')}

---

## 6. October Resequenced Vouchers Plan (Sample first 30 of ${octoberResequencedPlan.length})

| Voucher ID | Original rvNo | New Assigned rvNo | Date | Description |
| :--- | :--- | :--- | :--- | :--- |
${octoberResequencedPlan
  .slice(0, 30)
  .map(
    (p) =>
      `| \`${p.id.slice(0, 8)}...\` | \`${p.originalRvNo}\` | \`${p.newRvNo}\` | ${p.rvDate} | ${p.description || 'N/A'} |`,
  )
  .join('\n')}
`;

  fs.writeFileSync(mdPath, mdContent, 'utf-8');

  console.log(`\n=====================================================`);
  console.log(`📄 AUDIT REPORT GENERATED:`);
  console.log(`   Markdown Report : ${mdPath}`);
  console.log(`   JSON Data Dump  : ${jsonPath}`);
  console.log(`=====================================================\n`);
}

async function main() {
  const isDryRun = !process.argv.includes('--execute') && !process.argv.includes('--commit');

  console.log('=====================================================');
  if (isDryRun) {
    console.log('🔍 RUNNING IN DRY-RUN MODE (Default Safety Mode)');
    console.log('No database records will be modified.');
    console.log('To execute live migration, pass: --execute');
  } else {
    console.log('🚀 RUNNING IN LIVE MIGRATION MODE (--execute)');
    console.log('Database records WILL be permanently modified!');
  }
  console.log('=====================================================\n');

  // Optional custom cutoff date via argument, e.g. --cutoff=2026-09-30
  const cutoffArg = process.argv.find((a) => a.startsWith('--cutoff='));
  let cutoffDate = new Date('2026-09-30T23:59:59.999Z');
  if (cutoffArg) {
    const rawCutoff = cutoffArg.split('=')[1];
    cutoffDate = new Date(`${rawCutoff}T23:59:59.999Z`);
  }

  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  const managementUrl = (process.env.DATABASE_URL_MANAGEMENT || '')
    .replace('localhost', '127.0.0.1')
    .replace(':5433', ':5432');

  if (managementUrl && masterKey) {
    try {
      const pool = new Pool({ connectionString: managementUrl });
      const adapter = new PrismaPg(pool);
      const management = new ManagementClient({ adapter } as any);

      const companies = await management.company.findMany({
        where: { status: 'active' },
      });

      console.log(`📡 Found ${companies.length} active tenant companies in Master DB.`);

      for (const company of companies) {
        let tenantUrl = company.dbUrl;
        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            tenantUrl = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || '127.0.0.1'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch {}
        }

        if (!tenantUrl) continue;
        tenantUrl = tenantUrl.replace('localhost', '127.0.0.1').replace(':5433', ':5432');

        console.log(`\n👉 Connecting to tenant: ${company.name} (${company.code})...`);
        const prisma = new PrismaService({ tenantDbUrl: tenantUrl });

        try {
          await migrateRsrvVouchers(prisma, company.code, isDryRun, cutoffDate);
        } catch (err: any) {
          console.error(`❌ Migration error for ${company.code}: ${err.message}`, err.stack);
        } finally {
          await prisma.$disconnect();
        }
      }

      await management.$disconnect();
      await pool.end();
      return;
    } catch (mErr: any) {
      console.warn(`⚠️ Management DB connect skipped/failed (${mErr.message}).`);
    }
  }

  // Fallback to DATABASE_URL in .env
  const singleDbUrl = (process.env.DATABASE_URL || '')
    .replace('localhost', '127.0.0.1')
    .replace(':5433', ':5432');
  if (singleDbUrl) {
    console.log(`\n📡 Connecting to single DB using DATABASE_URL...`);
    const prisma = new PrismaService({ tenantDbUrl: singleDbUrl });
    try {
      await migrateRsrvVouchers(prisma, 'SINGLE_DB', isDryRun, cutoffDate);
    } finally {
      await prisma.$disconnect();
    }
  }
}

main().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
