import sys

with open('src/pos-session/pos-session.service.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

start_idx = -1
end_idx = -1

for i, line in enumerate(lines):
    if line.strip() == '// Lookup COA accounts dynamically' and lines[i+1].strip() == 'const allAccounts = await this.prisma.chartOfAccount.findMany({':
        # Find the occurrence inside generateDaywiseReconciliationVoucherForDate
        # Let's start looking from line 3000
        if i > 3000:
            start_idx = i
            break

for i in range(start_idx, len(lines)):
    if line.strip() == 'status: \'pending\',' and lines[i+1].strip() == 'details,':
        # Actually, let's find the `await this.receiptVoucherService.create({` block
        if lines[i-7].strip() == 'await this.receiptVoucherService.create({':
            end_idx = i + 2 # include details, });
            break

if start_idx != -1 and end_idx != -1:
    print(f"Replacing lines {start_idx} to {end_idx}")
    
    new_code = """    const jvDateStr = `${dateStr.split('-').reverse().join('/')}`;

    // Helper to get Account ID
    const accountMap = new Map<string, string>();
    const getAccountId = async (
      code: string | null | undefined,
    ): Promise<string | null> => {
      if (!code) return null;
      if (accountMap.has(code)) return accountMap.get(code)!;
      const acc = await this.prisma.chartOfAccount.findFirst({
        where: { code },
      });
      if (acc) {
        accountMap.set(code, acc.id);
        return acc.id;
      }
      return null;
    };

    const details: any[] = [];
    let hasMissingMappings = false;

    const addLine = async (
      code: string | null,
      tagCode: string | null,
      debit: number,
      credit: number,
      baseNarration: string,
    ) => {
      if (debit === 0 && credit === 0) return;

      let accountId = await getAccountId(code);
      const tagId = await getAccountId(tagCode);
      let narration = baseNarration;

      if (code && !accountId) {
        const fallback = await this.prisma.chartOfAccount.findFirst();
        accountId = fallback?.id || 'MISSING';
        narration = `[MISSING GL CODE: ${code}] ` + narration;
        hasMissingMappings = true;
      }

      if (tagCode && !tagId) {
        narration = `[MISSING TAG: ${tagCode}] ` + narration;
        hasMissingMappings = true;
      }

      if (!accountId) return; // if completely failed to fallback

      details.push({
        accountId,
        tagAccountId: tagId,
        debit,
        credit,
        narration,
      });
    };

    // 1. Credit / Debit Cards (Merchant)
    let totalCommission = 0;

    for (const card of reconData.cardPayments || []) {
      // Find bank GL code
      const merchant = await this.prisma.merchantConfig.findFirst({
        where: { bankName: card.bank },
        orderBy: { createdAt: 'desc' },
      });
      if (merchant?.bankGlCode) {
        const comm = Number((card.commission ?? 0).toFixed(2));
        totalCommission += comm;
        const netAmount = Number(((card.amount ?? 0) - comm).toFixed(2));
        await addLine(
          merchant.bankGlCode,
          locCode,
          netAmount,
          0,
          `Credit Card Sales ${card.bank} | ${jvDateStr}`,
        );
      }
    }
    for (const card of reconData.cardGiftVouchers || []) {
      const merchant = await this.prisma.merchantConfig.findFirst({
        where: { bankName: card.bank },
        orderBy: { createdAt: 'desc' },
      });
      if (merchant?.bankGlCode) {
        const comm = Number((card.commission ?? 0).toFixed(2));
        totalCommission += comm;
        const netAmount = Number(((card.amount ?? 0) - comm).toFixed(2));
        await addLine(
          merchant.bankGlCode,
          locCode,
          netAmount,
          0,
          `Credit Card Sales ${card.bank} | ${jvDateStr}`,
        );
      }
    }

    // 2. Total Credit/Debit Cards Commission
    await addLine(
      '80210001',
      locCode,
      totalCommission,
      0,
      `Total Credit Card Commission | ${jvDateStr}`,
    );

    // 3. Cash && Cash - Gift Vouchers Issued
    const cashGl = locationObj?.cashGLCode || '31090001';
    if (cashGl) {
      // Cash Sales entry
      const netCashSale =
        (reconData.cashBreakdown?.sale ?? 0) - (reconData.cashBreakdown?.refundVouchers ?? 0);
      await addLine(
        cashGl,
        locCode,
        netCashSale,
        0,
        `CASH SALES | ${jvDateStr}`,
      );

      // Cash - Gift Vouchers Issued entry
      await addLine(
        cashGl,
        locCode,
        reconData.cashBreakdown?.giftVouchers ?? 0,
        0,
        `Cash - Gift Vouchers Issued | ${jvDateStr}`,
      );
    }

    // Vouchers Redeemed (Received)
    for (const v of reconData.receivedVouchers || []) {
      if (v.type === 'Gift Vouchers Corporate') {
        const voucher = await this.prisma.voucher.findFirst({
          where: { code: v.from },
        });
        const tagId = voucher?.companyGlCode
          ? voucher.companyGlCode
          : locCode;
        await addLine(
          '12070008',
          tagId,
          v.amount,
          0,
          `Corporate Gift Vouchers Collected | GVC#${v.from} | ${jvDateStr}`,
        );
      } else if (v.type === 'Gift Vouchers') {
        await addLine(
          '12070007',
          locCode,
          v.amount,
          0,
          `Gift Voucher Collected | GV#${v.from} | ${jvDateStr}`,
        );
      } else if (v.type === 'Credit Vouchers') {
        await addLine(
          '12070006',
          locCode,
          v.amount,
          0,
          `Credit Voucher Collected | CRV#${v.from} | ${jvDateStr}`,
        );
      } else if (v.type === 'Claim Vouchers') {
        await addLine(
          '12070009',
          locCode,
          v.amount,
          0,
          `Claim Voucher Collected | CV#${v.from} | ${jvDateStr}`,
        );
      } else if (v.type === 'Exchange Vouchers') {
        await addLine(
          '12070010',
          locCode,
          v.amount,
          0,
          `Exchange Voucher Collected | EV#${v.from} | ${jvDateStr}`,
        );
      } else if (v.type === 'Vouchers') {
        const voucher = await this.prisma.voucher.findFirst({
          where: { code: v.from },
        });
        if (voucher && voucher.voucherType === 'REFUND') {
          const refundCode = v.from.startsWith('RF#')
            ? v.from
            : `RF#${v.from}`;
          await addLine(
            '12070015',
            locCode,
            v.amount,
            0,
            `Refund Voucher Collected | ${refundCode} | ${jvDateStr}`,
          );
        }
      }
    }

    // 9. On Credit (Receivables)
    for (const rec of reconData.receivables || []) {
      await addLine(
        '31030001',
        locCode,
        rec.amount,
        0,
        `Ded from staff salary ag.CM#123 NDC | ${jvDateStr}`,
      );
    }

    // Issued Vouchers
    for (const ev of reconData.issuedVouchers?.exchangeAndClaims || []) {
      if (ev.type === 'Exchange Vouchers') {
        await addLine(
          '12070010',
          locCode,
          0,
          ev.amount,
          `Exchange Voucher Issued | EV#${ev.from} | ${jvDateStr}`,
        );
      } else if (ev.type === 'Claim Vouchers') {
        await addLine(
          '12070009',
          locCode,
          0,
          ev.amount,
          `Claim Voucher Issued | CV#${ev.from} | ${jvDateStr}`,
        );
      }
    }
    for (const cv of reconData.issuedVouchers?.creditVouchers || []) {
      await addLine(
        '12070006',
        locCode,
        0,
        cv.amount,
        `Credit Voucher Issued | CRV#${cv.to} | ${jvDateStr}`,
      );
    }
    for (const gv of reconData.issuedVouchers?.giftVouchers || []) {
      if (gv.type === 'Gift Vouchers Corporate') {
        await addLine(
          '12070008',
          locCode,
          0,
          gv.amount,
          `Corporate Gift Voucher Issued | GVC#${gv.to} | ${jvDateStr}`,
        );
      } else {
        await addLine(
          '12070007',
          locCode,
          0,
          gv.amount,
          `Gift Voucher Issued | GV#${gv.to} | ${jvDateStr}`,
        );
      }
    }

    // Gift Voucher Discount
    const giftVoucherDiscountAmt =
      reconData.issuedVouchers?.totalGiftVoucherDiscount || 0;
    await addLine(
      '80180012',
      locCode,
      giftVoucherDiscountAmt,
      0,
      `Gift Voucher Discount | ${jvDateStr}`,
    );
    for (const rv of reconData.issuedVouchers?.refundVouchers || []) {
      const refundCode = rv.from.startsWith('RF#')
        ? rv.from
        : `RF#${rv.from}`;
      await addLine(
        '12070015',
        locCode,
        0,
        rv.amount,
        `Refund Voucher Issued | ${refundCode} | ${jvDateStr}`,
      );
    }

    // 14. FBR POS
    const fbrCash =
      reconData.fbrCharges?.find((c: any) => c.type === 'Cash')?.amount || 0;
    const fbrCard =
      reconData.fbrCharges?.find((c: any) => c.type === 'Card')?.amount || 0;
    await addLine(
      '12060009',
      locCode,
      0,
      fbrCard,
      `POS Service Fee Credit Card | ${jvDateStr}`,
    );
    await addLine(
      '12060009',
      locCode,
      0,
      fbrCash,
      `POS Service Fee Cash | ${jvDateStr}`,
    );

    // Sales Return
    await addLine(
      '40020014',
      locCode,
      reconData.financials?.salesReturn ?? 0,
      0,
      `Retail Sales Return | ${jvDateStr}`,
    );

    // Final Calculations
    const totalReceived =
      (reconData.cashBreakdown?.total ?? 0) + (reconData.paymentBreakdown?.voucher?.amount ?? 0);
    const netReceivedCard = reconData.cardBreakdown?.total ?? 0;

    const unusedBalanceVouchersAmt =
      reconData.issuedVouchers?.unusedBalanceVouchersTotal || 0;
    const cashGiftVouchersAmt = reconData.cashBreakdown?.giftVouchers ?? 0;
    const receivablesAmt = (reconData.receivables || []).reduce(
      (s: number, r: any) => s + r.amount,
      0,
    );

    // AC: 12070002 -> Transfer Current A/c Cash
    const transferCash =
      totalReceived +
      receivablesAmt -
      unusedBalanceVouchersAmt -
      cashGiftVouchersAmt -
      fbrCash;

    await addLine(
      '12070002',
      locCode,
      0,
      transferCash,
      `Transfer Current A/c Cash | ${jvDateStr}`,
    );

    // AC: 12070003 -> Transfer Current A/c Card
    const transferCard = Number((netReceivedCard - fbrCard).toFixed(2));
    await addLine(
      '12070003',
      locCode,
      0,
      transferCard,
      `Transfer Current A/c Card | ${jvDateStr}`,
    );

    // Auto-balance the voucher if debits and credits do not match
    let totalDebit = 0;
    let totalCredit = 0;
    details.forEach((d) => {
      totalDebit = Number((totalDebit + d.debit).toFixed(2));
      totalCredit = Number((totalCredit + d.credit).toFixed(2));
    });

    const diff = Math.abs(totalDebit - totalCredit);
    let description =
      `POS Daily Sales Reconciliation for ${reconData.locationName || locCode} (${locCode}) on ${dateStr}` +
      (hasMissingMappings
        ? `\\n\\nATTENTION: Some entries have missing Tag IDs or Account GL Codes. Please correct them before approving.`
        : '');

    if (diff > 0.01) {
      const fallback = await this.prisma.chartOfAccount.findFirst();
      const accountId = fallback?.id || 'MISSING';
      let balDebit = 0;
      let balCredit = 0;
      if (totalDebit > totalCredit) {
        balCredit = diff;
      } else {
        balDebit = diff;
      }
      details.push({
        accountId,
        tagAccountId: null,
        debit: balDebit,
        credit: balCredit,
        narration: `[AUTO-BALANCING LINE] To balance RV. Total Debit was ${totalDebit.toFixed(2)}, Total Credit was ${totalCredit.toFixed(2)}`,
      });
      description += `\\n\\nATTENTION: Voucher was unbalanced by ${diff.toFixed(2)}. An auto-balancing line was added. Please review and correct.`;

      totalDebit = 0;
      totalCredit = 0;
      details.forEach((d) => {
        totalDebit = Number((totalDebit + d.debit).toFixed(2));
        totalCredit = Number((totalCredit + d.credit).toFixed(2));
      });
    }

    if (totalDebit === 0) {
      this.logger.log(
        `Total debit is 0 for location ${locCode} on ${dateStr}, skipping Receipt Voucher generation.`,
      );
      return;
    }

    const rvNo = await generateNextRsrvNumber(this.prisma, dateStr);
    const firstDebitLine = details.find((d) => d.debit > 0);
    const fallback = await this.prisma.chartOfAccount.findFirst();
    const debitAccountId = firstDebitLine
      ? firstDebitLine.accountId
      : fallback?.id || 'MISSING';

    await this.receiptVoucherService.create({
      type: 'rs_rv',
      rvNo,
      rvDate: new Date(dateStr),
      debitAccountId,
      debitAmount: totalDebit,
      description,
      status: 'pending',
      details: details.map((d) => ({
        accountId: d.accountId,
        tagAccountId: d.tagAccountId || undefined,
        debit: d.debit,
        credit: d.credit,
        narration: d.narration,
      })),
    });\n"""
    
    # We replace from start_idx to end_idx + 1
    new_lines = lines[:start_idx] + [new_code] + lines[end_idx + 1:]
    
    with open('src/pos-session/pos-session.service.ts', 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print("Replaced successfully")
else:
    print("Could not find boundaries")
