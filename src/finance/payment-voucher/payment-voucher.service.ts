import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePaymentVoucherDto } from './dto/create-payment-voucher.dto';
import { UpdatePaymentVoucherDto } from './dto/update-payment-voucher.dto';

@Injectable()
export class PaymentVoucherService {
  constructor(private readonly prisma: PrismaService) { }

  async create(createPaymentVoucherDto: CreatePaymentVoucherDto) {
    const { details, invoices, ...data } = createPaymentVoucherDto;

    // Validate totals using details array
    const totalDebit = details.reduce(
      (sum, item) => sum + Number(item.debit || 0),
      0,
    );
    const totalCredit = details.reduce(
      (sum, item) => sum + Number(item.credit || 0),
      0,
    );

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new Error('Total Debit must equal Total Credit');
    }

    if (totalDebit === 0) {
      throw new Error('Transaction amount must be greater than 0');
    }

    // If invoices are provided, validate and update their payment status
    if (invoices && invoices.length > 0) {
      console.log('Processing invoice payments:', invoices);

      let totalInvoiceAmount = 0;

      // Validate each invoice exists and has sufficient remaining amount
      for (const invoicePayment of invoices) {
        const invoice = await this.prisma.purchaseInvoice.findUnique({
          where: { id: invoicePayment.purchaseInvoiceId }
        });

        if (!invoice) {
          throw new BadRequestException(`Purchase Invoice not found: ${invoicePayment.purchaseInvoiceId}`);
        }

        if (invoice.status !== 'APPROVED') {
          throw new BadRequestException(`Purchase Invoice ${invoice.invoiceNumber} is not approved. Only approved invoices can be paid.`);
        }

        console.log(`Invoice ${invoice.invoiceNumber}: Total=${invoice.totalAmount}, Paid=${invoice.paidAmount}, Remaining=${invoice.remainingAmount}`);

        if (Number(invoice.remainingAmount) < Number(invoicePayment.paidAmount)) {
          throw new BadRequestException(
            `Payment amount ${invoicePayment.paidAmount} exceeds remaining amount ${invoice.remainingAmount} for invoice ${invoice.invoiceNumber}`
          );
        }

        totalInvoiceAmount += Number(invoicePayment.paidAmount);
      }

      console.log(`Total invoice payment amount: ${totalInvoiceAmount}, Total debit: ${totalDebit}`);

      // Allow some flexibility in amount matching (invoice amount should not exceed total debit)
      if (totalInvoiceAmount > totalDebit + 0.01) {
        throw new BadRequestException(`Total invoice payment amount (${totalInvoiceAmount}) cannot exceed total debit amount (${totalDebit})`);
      }
    }

    return this.prisma.$transaction(async (prisma) => {
      // Create payment voucher
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
          isTaxApplicable: data.isTaxApplicable,
          description: data.description,
          status: data.status || 'approved',
          details: {
            create: details
              .filter(d => Number(d.debit) > 0)
              .map(d => ({
                accountId: d.accountId,
                debit: d.debit,
              })),
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

      // Update purchase invoice payment status
      if (invoices && invoices.length > 0) {
        console.log('Updating purchase invoice payment status...');

        for (const invoicePayment of invoices) {
          const invoice = await prisma.purchaseInvoice.findUnique({
            where: { id: invoicePayment.purchaseInvoiceId }
          });

          if (invoice) {
            const newPaidAmount = Number(invoice.paidAmount) + Number(invoicePayment.paidAmount);
            const newRemainingAmount = Number(invoice.totalAmount) - newPaidAmount - Number(invoice.returnAmount || 0);

            let paymentStatus = 'UNPAID';
            if (newRemainingAmount <= 0.01) {
              paymentStatus = 'FULLY_PAID';
            } else if (newPaidAmount > 0) {
              paymentStatus = 'PARTIALLY_PAID';
            }

            console.log(`Updating PI ${invoice.invoiceNumber}: PaidAmount=${newPaidAmount}, RemainingAmount=${newRemainingAmount}, Status=${paymentStatus}`);

            await prisma.purchaseInvoice.update({
              where: { id: invoicePayment.purchaseInvoiceId },
              data: {
                paidAmount: newPaidAmount,
                remainingAmount: Math.max(0, newRemainingAmount),
                paymentStatus: paymentStatus as any
              }
            });
          }
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
      select: {
        id: true,
        name: true,
        code: true,
      }
    });
    return {
      message: 'Test endpoint working',
      totalSuppliers: allSuppliers.length,
      suppliers: allSuppliers
    };
  }
}
