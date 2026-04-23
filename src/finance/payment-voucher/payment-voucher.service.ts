import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePaymentVoucherDto } from './dto/create-payment-voucher.dto';
import { UpdatePaymentVoucherDto } from './dto/update-payment-voucher.dto';
import { AccountingService } from '../accounting/accounting.service';
import { FinanceAccountConfigService } from '../finance-account-config/finance-account-config.service';
import { AccountRoleKey } from '../finance-account-config/dto/finance-account-config.dto';

@Injectable()
export class PaymentVoucherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly financeConfig: FinanceAccountConfigService,
  ) { }

  async create(createPaymentVoucherDto: CreatePaymentVoucherDto) {
    const { details, invoices, advanceApplications, ...data } = createPaymentVoucherDto;

    const totalDebit = details.reduce((sum, item) => sum + Number(item.debit || 0), 0);
    const totalCredit = details.reduce((sum, item) => sum + Number(item.credit || 0), 0);

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new Error('Total Debit must equal Total Credit');
    }

    if (totalDebit === 0 && (!advanceApplications || advanceApplications.length === 0)) {
      throw new Error('Transaction amount must be greater than 0');
    }

    // ── Validate advance applications ────────────────────────────────────────
    const totalAdvanceApplied = advanceApplications?.reduce((s, a) => s + Number(a.appliedAmount), 0) ?? 0;

    if (advanceApplications && advanceApplications.length > 0) {
      for (const app of advanceApplications) {
        const advPV = await this.prisma.paymentVoucher.findUnique({
          where: { id: app.advanceVoucherId },
          include: { advanceUsages: true },
        });
        if (!advPV) throw new BadRequestException(`Advance voucher not found: ${app.advanceVoucherId}`);
        if (!advPV.isAdvance) throw new BadRequestException(`Voucher ${advPV.pvNo} is not an advance payment`);

        const alreadyUsed = advPV.advanceUsages.reduce((s, u) => s + Number(u.appliedAmount), 0);
        const available = Number(advPV.creditAmount) - alreadyUsed;
        if (Number(app.appliedAmount) > available + 0.01) {
          throw new BadRequestException(
            `Advance ${advPV.pvNo} only has ${available.toLocaleString()} available (requested ${app.appliedAmount})`
          );
        }
      }
    }

    // ── Validate invoice payments ────────────────────────────────────────────
    if (invoices && invoices.length > 0) {
      let totalInvoiceAmount = 0;
      for (const invoicePayment of invoices) {
        const invoice = await this.prisma.purchaseInvoice.findUnique({
          where: { id: invoicePayment.purchaseInvoiceId }
        });
        if (!invoice) throw new BadRequestException(`Purchase Invoice not found: ${invoicePayment.purchaseInvoiceId}`);
        if (invoice.status !== 'APPROVED') throw new BadRequestException(`Invoice ${invoice.invoiceNumber} is not approved`);
        if (Number(invoice.remainingAmount) < Number(invoicePayment.paidAmount)) {
          throw new BadRequestException(
            `Payment ${invoicePayment.paidAmount} exceeds remaining ${invoice.remainingAmount} for ${invoice.invoiceNumber}`
          );
        }
        totalInvoiceAmount += Number(invoicePayment.paidAmount);
      }

      // Total settled = cash paid (debit) + advance applied
      const totalSettled = totalDebit + totalAdvanceApplied;
      if (totalInvoiceAmount > totalSettled + 0.01) {
        throw new BadRequestException(
          `Invoice payments (${totalInvoiceAmount}) exceed total settled amount — cash (${totalDebit}) + advance (${totalAdvanceApplied}) = ${totalSettled}`
        );
      }
    }

    // ── Get ADVANCE TO SUPPLIERS account from finance configuration ─────────
    const advanceAccountId = totalAdvanceApplied > 0
      ? await this.financeConfig.resolveAccount(AccountRoleKey.ADVANCE_TO_SUPPLIERS)
      : null;

    return this.prisma.$transaction(async (prisma) => {
      // Create the payment voucher (cash/bank portion)
      const paymentVoucher = await prisma.paymentVoucher.create({
        data: {
          type: data.type,
          pvNo: data.pvNo,
          pvDate: data.pvDate,
          refBillNo: data.refBillNo,
          billDate: data.billDate,
          chequeNo: data.chequeNo,
          chequeDate: data.chequeDate,
          creditAccountId: data.creditAccountId,
          supplierId: data.supplierId || undefined,
          creditAmount: data.creditAmount || totalDebit || 0,
          isAdvance: data.isAdvance,
          advanceApplied: totalAdvanceApplied,
          isTaxApplicable: data.isTaxApplicable,
          description: data.description,
          status: data.status || 'approved',
          details: {
            create: details
              .filter(d => Number(d.debit) > 0)
              .map(d => ({ accountId: d.accountId, debit: d.debit })),
          },
        },
        include: { details: { include: { account: true } }, creditAccount: true, supplier: true },
      });

      // ── Update invoice payment statuses ─────────────────────────────────
      if (invoices && invoices.length > 0) {
        for (const invoicePayment of invoices) {
          const invoice = await prisma.purchaseInvoice.findUnique({
            where: { id: invoicePayment.purchaseInvoiceId }
          });
          if (invoice) {
            const newPaidAmount = Number(invoice.paidAmount) + Number(invoicePayment.paidAmount);
            const newRemainingAmount = Number(invoice.totalAmount) - newPaidAmount - Number(invoice.returnAmount || 0);
            let paymentStatus = 'UNPAID';
            if (newRemainingAmount <= 0.01) paymentStatus = 'FULLY_PAID';
            else if (newPaidAmount > 0) paymentStatus = 'PARTIALLY_PAID';

            await prisma.purchaseInvoice.update({
              where: { id: invoicePayment.purchaseInvoiceId },
              data: {
                paidAmount: newPaidAmount,
                remainingAmount: Math.max(0, newRemainingAmount),
                paymentStatus: paymentStatus as any,
              }
            });

            await prisma.paymentVoucherToInvoice.create({
              data: {
                paymentVoucherId: paymentVoucher.id,
                purchaseInvoiceId: invoicePayment.purchaseInvoiceId,
                paidAmount: invoicePayment.paidAmount,
              }
            });
          }
        }
      }

      // ── Apply advances: record usage + post reversal journal ────────────
      if (advanceApplications && advanceApplications.length > 0 && advanceAccountId) {
        for (const app of advanceApplications) {
          // Track usage against the source advance PV
          await prisma.advanceApplication.create({
            data: {
              sourceAdvanceId: app.advanceVoucherId,
              appliedInVoucherId: paymentVoucher.id,
              appliedAmount: app.appliedAmount,
            }
          });

          // Update advanceApplied on the source advance PV
          await prisma.paymentVoucher.update({
            where: { id: app.advanceVoucherId },
            data: { advanceApplied: { increment: app.appliedAmount } },
          });

          // Journal: Dr A/P PARTIES (supplier payable) / Cr ADVANCE TO SUPPLIERS
          // This clears the advance and reduces the payable
          const apParties = details.find(d => Number(d.debit) > 0);
          const apPartiesAccountId = apParties?.accountId ?? data.creditAccountId;

          await this.accounting.postLines([
            { accountId: apPartiesAccountId, debit: Number(app.appliedAmount), credit: 0 },
            { accountId: advanceAccountId, debit: 0, credit: Number(app.appliedAmount) },
          ], {
            sourceType: 'ADVANCE_APPLICATION',
            sourceId: paymentVoucher.id,
            sourceRef: `${paymentVoucher.pvNo}-ADV`,
            description: `Advance applied from advance voucher`,
            transactionDate: new Date(data.pvDate),
          }, prisma);
        }
      }

      // ── Post main journal lines (cash/bank payment) ──────────────────────
      if (totalDebit > 0) {
        const debitLines = details
          .filter(d => Number(d.debit) > 0)
          .map(d => ({ accountId: d.accountId, debit: Number(d.debit), credit: 0 }));
        const creditLines = [{ accountId: data.creditAccountId, debit: 0, credit: totalDebit }];
        await this.accounting.postLines([...debitLines, ...creditLines], {
          sourceType: 'PAYMENT_VOUCHER',
          sourceId: paymentVoucher.id,
          sourceRef: paymentVoucher.pvNo,
          description: data.description || `Payment Voucher: ${paymentVoucher.pvNo}`,
          transactionDate: new Date(data.pvDate),
        }, prisma);
      }

      // ── Write supplier ledger entries ────────────────────────────────────
      if (data.supplierId) {
        const supplier = await prisma.supplier.findUnique({
          where: { id: data.supplierId },
          select: { currentBalance: true, advanceBalance: true },
        });
        if (supplier) {
          let runningBalance = Number(supplier.currentBalance);
          let runningAdvance = Number(supplier.advanceBalance);

          if (data.isAdvance) {
            // Advance payment: advance balance increases, AP balance unchanged
            runningAdvance += totalDebit;
            await prisma.supplierLedger.create({
              data: {
                supplierId: data.supplierId,
                entryDate: new Date(data.pvDate),
                entryType: 'ADVANCE_PAYMENT',
                sourceId: paymentVoucher.id,
                sourceRef: paymentVoucher.pvNo,
                description: data.description || `Advance payment`,
                debit: totalDebit,
                credit: 0,
                balanceAfter: runningBalance,
                advanceDebit: totalDebit,
                advanceCredit: 0,
                advanceBalance: runningAdvance,
              },
            });
          } else {
            // Regular payment: reduces AP balance
            runningBalance -= totalDebit;
            if (totalDebit > 0) {
              await prisma.supplierLedger.create({
                data: {
                  supplierId: data.supplierId,
                  entryDate: new Date(data.pvDate),
                  entryType: 'PAYMENT_VOUCHER',
                  sourceId: paymentVoucher.id,
                  sourceRef: paymentVoucher.pvNo,
                  description: data.description || `Payment voucher`,
                  debit: totalDebit,
                  credit: 0,
                  balanceAfter: runningBalance,
                  advanceDebit: 0,
                  advanceCredit: 0,
                  advanceBalance: runningAdvance,
                },
              });
            }

            // Advance applications: reduce advance balance
            for (const app of advanceApplications ?? []) {
              runningBalance -= Number(app.appliedAmount);
              runningAdvance -= Number(app.appliedAmount);
              await prisma.supplierLedger.create({
                data: {
                  supplierId: data.supplierId,
                  entryDate: new Date(data.pvDate),
                  entryType: 'ADVANCE_APPLICATION',
                  sourceId: paymentVoucher.id,
                  sourceRef: `${paymentVoucher.pvNo}-ADV`,
                  description: `Advance applied toward payment`,
                  debit: Number(app.appliedAmount),
                  credit: 0,
                  balanceAfter: runningBalance,
                  advanceDebit: 0,
                  advanceCredit: Number(app.appliedAmount),
                  advanceBalance: runningAdvance,
                },
              });
            }
          }

          // Persist updated balances on supplier
          await prisma.supplier.update({
            where: { id: data.supplierId },
            data: {
              currentBalance: runningBalance,
              advanceBalance: runningAdvance,
            },
          });
        }
      }

      return paymentVoucher;
    });
  }

  async findAll(filters?: {
    type?: string;
    status?: string;
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const { type, status, page = 1, limit = 10, search } = filters || {};

    const where: any = {};

    if (type) where.type = type;
    if (status) where.status = status;

    if (search) {
      where.OR = [
        { pvNo: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { refBillNo: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.paymentVoucher.findMany({
        where,
        include: {
          details: {
            include: {
              account: true,
            },
          },
          creditAccount: true,
          supplier: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      }),
      this.prisma.paymentVoucher.count({ where }),
    ]);

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const paymentVoucher = await this.prisma.paymentVoucher.findUnique({
      where: { id },
      include: {
        details: {
          include: {
            account: true,
          },
        },
        creditAccount: true,
        supplier: true,
      },
    });

    if (!paymentVoucher) {
      throw new NotFoundException(`Payment Voucher with ID ${id} not found`);
    }

    return paymentVoucher;
  }

  async update(id: string, updatePaymentVoucherDto: UpdatePaymentVoucherDto) {
    const { details, ...data } = updatePaymentVoucherDto;

    await this.findOne(id);

    if (details) {
      const totalDebit = details.reduce(
        (sum, item) => sum + Number(item.debit),
        0,
      );
      // Use existing credit amount if not provided, but difficult to fetch efficiently inside update logic without extra query
      // For now assume safely validated or valid if updated via form logic

      return this.prisma.$transaction(async (prisma) => {
        await prisma.paymentVoucherDetail.deleteMany({
          where: { paymentVoucherId: id },
        });

        return prisma.paymentVoucher.update({
          where: { id },
          data: {
            type: data.type,
            pvNo: data.pvNo,
            pvDate: data.pvDate,
            refBillNo: data.refBillNo,
            billDate: data.billDate,
            chequeNo: data.chequeNo,
            chequeDate: data.chequeDate,
            creditAccountId: data.creditAccountId,
            supplierId: data.supplierId,
            creditAmount: data.creditAmount,
            isAdvance: data.isAdvance,
            isTaxApplicable: data.isTaxApplicable,
            description: data.description,
            status: data.status,
            details: {
              create: details,
            },
          },
          include: {
            details: {
              include: {
                account: true,
              },
            },
            creditAccount: true,
            supplier: true,
          },
        });
      });
    }

    return this.prisma.paymentVoucher.update({
      where: { id },
      data: {
        type: data.type,
        pvNo: data.pvNo,
        pvDate: data.pvDate,
        refBillNo: data.refBillNo,
        billDate: data.billDate,
        chequeNo: data.chequeNo,
        chequeDate: data.chequeDate,
        creditAccountId: data.creditAccountId,
        supplierId: data.supplierId,
        creditAmount: data.creditAmount,
        isAdvance: data.isAdvance,
        isTaxApplicable: data.isTaxApplicable,
        description: data.description,
        status: data.status,
      },
      include: {
        details: {
          include: {
            account: true,
          },
        },
        creditAccount: true,
        supplier: true,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.paymentVoucher.delete({
      where: { id },
    });
  }

  async getNextPvNumber(type: string): Promise<{ nextPvNumber: string }> {
    const currentYear = new Date().getFullYear();
    const prefix = type === 'bank' ? 'BPV' : 'CPV';

    const lastVoucher = await this.prisma.paymentVoucher.findFirst({
      where: {
        type,
        pvNo: {
          startsWith: `${prefix}-${currentYear}`,
        },
      },
      orderBy: {
        pvNo: 'desc',
      },
    });

    let nextNumber = 1;
    if (lastVoucher) {
      const lastNumber = parseInt(lastVoucher.pvNo.split('-').pop() || '0');
      nextNumber = lastNumber + 1;
    }

    const nextPvNumber = `${prefix}-${currentYear}-${nextNumber.toString().padStart(4, '0')}`;
    return { nextPvNumber };
  }

  async getSummary(type?: string) {
    const where = type ? { type } : {};

    const [
      totalVouchers,
      pendingVouchers,
      approvedVouchers,
      totalAmount,
      pendingAmount,
    ] = await Promise.all([
      this.prisma.paymentVoucher.count({ where }),
      this.prisma.paymentVoucher.count({ where: { ...where, status: 'pending' } }),
      this.prisma.paymentVoucher.count({ where: { ...where, status: 'approved' } }),
      this.prisma.paymentVoucher.aggregate({
        where,
        _sum: { creditAmount: true },
      }),
      this.prisma.paymentVoucher.aggregate({
        where: { ...where, status: 'pending' },
        _sum: { creditAmount: true },
      }),
    ]);

    return {
      totalVouchers,
      pendingVouchers,
      approvedVouchers,
      totalAmount: totalAmount._sum.creditAmount || 0,
      pendingAmount: pendingAmount._sum.creditAmount || 0,
    };
  }

  // Get pending/unpaid purchase invoices for a supplier
  async getPendingInvoicesBySupplier(supplierId: string) {
    console.log(`Getting pending invoices for supplier: ${supplierId}`);

    try {
      // Only return APPROVED invoices as per user requirement
      const invoices = await this.prisma.purchaseInvoice.findMany({
        where: {
          supplierId,
          paymentStatus: {
            in: ['UNPAID', 'PARTIALLY_PAID']
          },
          status: 'APPROVED'
        },
        select: {
          id: true,
          invoiceNumber: true,
          invoiceDate: true,
          totalAmount: true,
          paidAmount: true,
          returnAmount: true,
          remainingAmount: true,
          status: true,
          paymentStatus: true,
          supplier: {
            select: {
              id: true,
              name: true
            }
          }
        },
        orderBy: {
          invoiceDate: 'asc'
        }
      });

      console.log(`Found ${invoices.length} APPROVED pending invoices`);
      return invoices;
    } catch (error) {
      console.error('Error getting pending invoices:', error);
      throw error;
    }
  }

  // Get all suppliers with pending invoices
  async getSuppliersWithPendingInvoices() {
    console.log('SERVICE - Getting suppliers with pending invoices...');

    try {
      // Direct approach - get all suppliers and their invoice counts
      const allSuppliers = await this.prisma.supplier.findMany({
        include: {
          purchaseInvoices: {
            where: {
              paymentStatus: {
                in: ['UNPAID', 'PARTIALLY_PAID']
              },
              status: 'APPROVED'
            },
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              paymentStatus: true,
              totalAmount: true,
              remainingAmount: true
            }
          }
        }
      });

      console.log(`SERVICE - Found ${allSuppliers.length} total suppliers`);

      // Filter suppliers that have pending invoices
      const suppliersWithPendingInvoices = allSuppliers
        .filter(supplier => supplier.purchaseInvoices.length > 0)
        .map(supplier => ({
          id: supplier.id,
          name: supplier.name,
          code: supplier.code,
          _count: {
            purchaseInvoices: supplier.purchaseInvoices.length
          },
          // Debug info
          invoices: supplier.purchaseInvoices
        }));

      console.log(`SERVICE - Found ${suppliersWithPendingInvoices.length} suppliers with pending invoices:`);

      suppliersWithPendingInvoices.forEach(supplier => {
        console.log(`SERVICE - ${supplier.name} (${supplier.code}): ${supplier._count.purchaseInvoices} pending invoices`);
        supplier.invoices.forEach(invoice => {
          console.log(`SERVICE -   * ${invoice.invoiceNumber} - ${invoice.status} - ${invoice.paymentStatus} - ${invoice.remainingAmount}`);
        });
      });

      // Return without debug invoices info
      const finalResult = suppliersWithPendingInvoices.map(supplier => ({
        id: supplier.id,
        name: supplier.name,
        code: supplier.code,
        _count: supplier._count
      }));

      console.log('SERVICE - Final result to return:', finalResult);
      return finalResult;

    } catch (error) {
      console.error('SERVICE - Error getting suppliers with pending invoices:', error);
      throw error;
    }
  }

  async updateStatus(id: string, status: string, remarks?: string) {
    await this.findOne(id);

    const validStatuses = ['pending', 'approved', 'rejected'];
    if (!validStatuses.includes(status)) {
      throw new BadRequestException('Invalid status. Must be pending, approved, or rejected');
    }

    return this.prisma.paymentVoucher.update({
      where: { id },
      data: {
        status,
        ...(remarks && { description: remarks }),
      },
      include: {
        details: {
          include: {
            account: true,
          },
        },
        creditAccount: true,
        supplier: true,
      },
    });
  }

  // Debug methods
  async debugInvoices() {
    const invoices = await this.prisma.purchaseInvoice.findMany({
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        paymentStatus: true,
        totalAmount: true,
        paidAmount: true,
        remainingAmount: true,
        supplier: {
          select: {
            id: true,
            name: true,
            code: true
          }
        }
      }
    });

    return {
      message: 'Debug invoice data',
      totalInvoices: invoices.length,
      invoices: invoices
    };
  }

  async testSuppliers() {
    const allSuppliers = await this.prisma.supplier.findMany({
      select: { id: true, name: true, code: true }
    });
    return { message: 'Test endpoint working', totalSuppliers: allSuppliers.length, suppliers: allSuppliers };
  }

  // Get unapplied advance payment vouchers for a supplier
  async getAdvancesBySupplier(supplierId: string) {
    // Query advance PVs directly — don't gate on advanceBalance
    // (advanceBalance may be 0 for advances created before the ledger system)
    const advances = await this.prisma.paymentVoucher.findMany({
      where: { supplierId, isAdvance: true, status: 'approved' },
      include: { advanceUsages: true },
      orderBy: { pvDate: 'asc' },
    });

    return advances
      .map(pv => {
        const used = pv.advanceUsages.reduce((s, u) => s + Number(u.appliedAmount), 0);
        const available = Number(pv.creditAmount) - used;
        return {
          pvId: pv.id,
          pvNo: pv.pvNo,
          pvDate: pv.pvDate,
          totalAmount: Number(pv.creditAmount),
          usedAmount: used,
          availableAmount: available,
        };
      })
      .filter(pv => pv.availableAmount > 0.01);
  }

  // Quick supplier balance summary — called on supplier selection in the form
  async getSupplierSummary(supplierId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, code: true, currentBalance: true, advanceBalance: true, openingBalance: true },
    });
    if (!supplier) throw new NotFoundException(`Supplier ${supplierId} not found`);

    // Compute live advance balance from PVs in case ledger hasn't been seeded yet
    const advances = await this.prisma.paymentVoucher.findMany({
      where: { supplierId, isAdvance: true, status: 'approved' },
      include: { advanceUsages: true },
    });
    const liveAdvanceBalance = advances.reduce((sum, pv) => {
      const used = pv.advanceUsages.reduce((s, u) => s + Number(u.appliedAmount), 0);
      return sum + Math.max(0, Number(pv.creditAmount) - used);
    }, 0);

    // Compute live AP balance from purchase invoices
    const invoiceAgg = await this.prisma.purchaseInvoice.aggregate({
      where: { supplierId, status: 'APPROVED', paymentStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] } },
      _sum: { remainingAmount: true },
    });
    const liveApBalance = Number(invoiceAgg._sum.remainingAmount ?? 0);

    return {
      supplierId: supplier.id,
      name: supplier.name,
      code: supplier.code,
      apBalance: liveApBalance,          // total outstanding payable
      advanceBalance: liveAdvanceBalance, // unapplied advance available
    };
  }

  // Get full supplier ledger statement
  async getSupplierLedger(supplierId: string, fromDate?: string, toDate?: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, code: true, currentBalance: true, advanceBalance: true, openingBalance: true },
    });
    if (!supplier) throw new NotFoundException(`Supplier ${supplierId} not found`);

    const where: any = { supplierId };
    if (fromDate || toDate) {
      where.entryDate = {};
      if (fromDate) where.entryDate.gte = new Date(fromDate);
      if (toDate) where.entryDate.lte = new Date(toDate);
    }

    const entries = await this.prisma.supplierLedger.findMany({
      where,
      orderBy: { entryDate: 'asc' },
    });

    return {
      supplier,
      entries,
      summary: {
        totalInvoiced: entries.filter(e => e.entryType === 'PURCHASE_INVOICE').reduce((s, e) => s + Number(e.credit), 0),
        totalPaid: entries.filter(e => ['PAYMENT_VOUCHER', 'ADVANCE_APPLICATION'].includes(e.entryType)).reduce((s, e) => s + Number(e.debit), 0),
        totalAdvancePaid: entries.filter(e => e.entryType === 'ADVANCE_PAYMENT').reduce((s, e) => s + Number(e.advanceDebit), 0),
        totalAdvanceApplied: entries.filter(e => e.entryType === 'ADVANCE_APPLICATION').reduce((s, e) => s + Number(e.advanceCredit), 0),
        currentBalance: Number(supplier.currentBalance),
        advanceBalance: Number(supplier.advanceBalance),
      },
    };
  }

  // Called by PurchaseInvoiceService when a PI is approved — writes ledger credit entry
  async recordInvoiceInLedger(prismaClient: any, supplierId: string, invoiceId: string, invoiceRef: string, amount: number, invoiceDate: Date) {
    const supplier = await prismaClient.supplier.findUnique({
      where: { id: supplierId },
      select: { currentBalance: true, advanceBalance: true },
    });
    if (!supplier) return;

    const newBalance = Number(supplier.currentBalance) + amount;
    await prismaClient.supplierLedger.create({
      data: {
        supplierId,
        entryDate: invoiceDate,
        entryType: 'PURCHASE_INVOICE',
        sourceId: invoiceId,
        sourceRef: invoiceRef,
        description: `Purchase Invoice raised`,
        debit: 0,
        credit: amount,
        balanceAfter: newBalance,
        advanceDebit: 0,
        advanceCredit: 0,
        advanceBalance: Number(supplier.advanceBalance),
      },
    });
    await prismaClient.supplier.update({
      where: { id: supplierId },
      data: { currentBalance: newBalance },
    });
  }
}
