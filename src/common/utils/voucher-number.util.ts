export function getFiscalYearLabel(dateInput: Date | string): string {
  const date = new Date(dateInput);
  const m = date.getMonth(); // 0-indexed, July is 6
  const y = date.getFullYear();
  const startYear = m >= 6 ? y : y - 1;
  const endYear = startYear + 1;
  return `${startYear.toString().slice(-2)}-${endYear.toString().slice(-2)}`;
}

export async function generateNextJvNumber(prisma: any, date: Date | string): Promise<string> {
  const fyLabel = getFiscalYearLabel(date);
  const prefix = `JV-${fyLabel}-`;
  
  const lastJV = await prisma.journalVoucher.findFirst({
    where: {
      jvNo: {
        startsWith: prefix,
      },
    },
    orderBy: {
      jvNo: 'desc',
    },
    select: { jvNo: true },
  });

  let nextSeq = 1;
  if (lastJV) {
    const parts = lastJV.jvNo.split('-');
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastSeq)) {
      nextSeq = lastSeq + 1;
    }
  }

  return `${prefix}${nextSeq.toString().padStart(4, '0')}`;
}

export async function generateNextPvNumber(prisma: any, type: string, date: Date | string): Promise<string> {
  const fyLabel = getFiscalYearLabel(date);
  const prefix = type === 'bank' ? 'BPV' : 'CPV';
  const prefixWithFy = `${prefix}-${fyLabel}-`;

  const lastPV = await prisma.paymentVoucher.findFirst({
    where: {
      type,
      pvNo: {
        startsWith: prefixWithFy,
      },
    },
    orderBy: {
      pvNo: 'desc',
    },
    select: { pvNo: true },
  });

  let nextSeq = 1;
  if (lastPV) {
    const parts = lastPV.pvNo.split('-');
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastSeq)) {
      nextSeq = lastSeq + 1;
    }
  }

  return `${prefixWithFy}${nextSeq.toString().padStart(4, '0')}`;
}

export async function generateNextRvNumber(prisma: any, type: string, date: Date | string): Promise<string> {
  const fyLabel = getFiscalYearLabel(date);
  const prefix = type === 'bank' ? 'BRV' : 'CRV';
  const prefixWithFy = `${prefix}-${fyLabel}-`;

  const lastRV = await prisma.receiptVoucher.findFirst({
    where: {
      type,
      rvNo: {
        startsWith: prefixWithFy,
      },
    },
    orderBy: {
      rvNo: 'desc',
    },
    select: { rvNo: true },
  });

  let nextSeq = 1;
  if (lastRV) {
    const parts = lastRV.rvNo.split('-');
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastSeq)) {
      nextSeq = lastSeq + 1;
    }
  }

  return `${prefixWithFy}${nextSeq.toString().padStart(4, '0')}`;
}

export async function generateNextFolioNumber(prisma: any, date: Date | string): Promise<string> {
  const fyLabel = getFiscalYearLabel(date);
  const folioPrefix = `FOL-${fyLabel}-`;

  const [lastJV, lastPV, lastRV] = await Promise.all([
    prisma.journalVoucher.findFirst({
      where: { folio: { startsWith: folioPrefix } },
      orderBy: { folio: 'desc' },
      select: { folio: true }
    }),
    prisma.paymentVoucher.findFirst({
      where: { folio: { startsWith: folioPrefix } },
      orderBy: { folio: 'desc' },
      select: { folio: true }
    }),
    prisma.receiptVoucher.findFirst({
      where: { folio: { startsWith: folioPrefix } },
      orderBy: { folio: 'desc' },
      select: { folio: true }
    })
  ]);

  const parseFolioSeq = (folio: string | null) => {
    if (!folio) return 0;
    const parts = folio.split('-');
    const seq = parseInt(parts[parts.length - 1], 10);
    return isNaN(seq) ? 0 : seq;
  };

  const seqJV = parseFolioSeq(lastJV?.folio);
  const seqPV = parseFolioSeq(lastPV?.folio);
  const seqRV = parseFolioSeq(lastRV?.folio);

  const nextFolioSeq = Math.max(seqJV, seqPV, seqRV) + 1;
  return `${folioPrefix}${nextFolioSeq.toString().padStart(4, '0')}`;
}
