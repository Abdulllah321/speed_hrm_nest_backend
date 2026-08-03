import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateCprDto, UpdateCprDto, PreviewCprDto, ConfirmBatchCprDto } from './dto/cpr.dto';


@Injectable()
export class CprService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateCprDto) {
    this.prisma.ensureTenantContext();
    return this.prisma.cprTax.create({
      data: {
        employeeId: data.employeeId || null,
        cnic: data.cnic,
        name: data.name,
        city: data.city || null,
        cprNo: data.cprNo,
        carAmount: data.carAmount !== undefined ? data.carAmount : null,
        ntn: data.ntn || null,
        taxableAmountAnnual: data.taxableAmountAnnual !== undefined ? data.taxableAmountAnnual : null,
        taxableAmountGross: data.taxableAmountGross !== undefined ? data.taxableAmountGross : null,
        taxAmountMonthlyTax: data.taxAmountMonthlyTax !== undefined ? data.taxAmountMonthlyTax : null,
        taxAmountAnnual: data.taxAmountAnnual !== undefined ? data.taxAmountAnnual : null,
        taxPeriod: data.taxPeriod || null,
        paymentDate: data.paymentDate ? new Date(data.paymentDate) : null,
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            employeeName: true,
          }
        }
      }
    });
  }

  async list(filters?: { month?: string; year?: string; months?: string }) {
    this.prisma.ensureTenantContext();

    // 1. Resolve which periods to fetch/process
    let periods: string[] = [];
    if (filters?.months) {
      periods = filters.months.split(',').map(m => m.trim()).filter(Boolean);
    } else if (filters?.month && filters?.year && filters.month !== 'all' && filters.year !== 'all') {
      const monthStr = String(Number(filters.month)).padStart(2, '0');
      const yearStr = String(filters.year);
      periods = [`${yearStr}-${monthStr}`];
    }

    if (periods.length > 0) {
      // Fetch active tax slabs once
      const allTaxSlabs = await this.prisma.taxSlab.findMany({
        where: { status: 'active', isDeleted: false }
      });

      for (const targetPeriod of periods) {
        const [yearStr, monthStr] = targetPeriod.split('-');
        if (!yearStr || !monthStr) continue;

        // Fetch confirmed payroll for the loop period
        const payroll = await this.prisma.payroll.findFirst({
          where: {
            month: monthStr,
            year: yearStr,
            status: 'confirmed'
          },
          include: {
            details: true,
          }
        });

        if (payroll) {
          for (const detail of payroll.details) {
            // Find if there is already a CprTax record for this employee and target taxPeriod
            let cprRecord = await this.prisma.cprTax.findFirst({
              where: {
                employeeId: detail.employeeId,
                taxPeriod: targetPeriod,
              }
            });

            // Find the baseline/oldest record for copying info (or employee details)
            const baselineRecord = await this.prisma.cprTax.findFirst({
              where: {
                employeeId: detail.employeeId,
              },
              orderBy: {
                createdAt: 'asc',
              }
            });

            // Fetch the employee object for name and CNIC as fallback
            const employee = await this.prisma.employee.findUnique({
              where: { id: detail.employeeId }
            });

            if (!cprRecord && (baselineRecord || employee)) {
              // Create a separate record for this month
              cprRecord = await this.prisma.cprTax.create({
                data: {
                  employeeId: detail.employeeId,
                  cnic: baselineRecord?.cnic || employee?.cnicNumber || '',
                  name: baselineRecord?.name || employee?.employeeName || '',
                  city: baselineRecord?.city || null,
                  cprNo: baselineRecord?.cprNo || '—',
                  carAmount: baselineRecord?.carAmount || null,
                  ntn: baselineRecord?.ntn || null,
                  taxPeriod: targetPeriod,
                }
              });
            }

            if (cprRecord) {
              // Get base annual taxable income from payroll
              let baseAnnualTaxable = 0;
              let carBenefitInBreakup = 0;
              if (detail.taxBreakup) {
                const breakup = typeof detail.taxBreakup === 'string'
                  ? JSON.parse(detail.taxBreakup)
                  : (detail.taxBreakup as any);

                if (breakup && breakup.taxableIncome !== undefined) {
                  baseAnnualTaxable = Number(breakup.taxableIncome || 0);
                }
                if (breakup && breakup.carBenefit !== undefined) {
                  carBenefitInBreakup = Number(breakup.carBenefit || 0);
                }
              }

              // Calculate car benefit: 5% of carAmount
              const carAmountVal = cprRecord.carAmount !== null ? Number(cprRecord.carAmount) : 0;
              const carBenefit = carAmountVal * 0.05;
              // Avoid double adding car perk if it's already in payroll taxBreakup.taxableIncome
              const newTaxableAnnual = (baseAnnualTaxable - carBenefitInBreakup) + carBenefit;


              // Calculate Monthly Taxable Gross = Sum of taxable salary breakup components + taxable allowances
              let monthlyTaxableGross = 0;
              if (detail.salaryBreakup) {
                const sBreakup = typeof detail.salaryBreakup === 'string'
                  ? JSON.parse(detail.salaryBreakup)
                  : (detail.salaryBreakup as any);
                if (Array.isArray(sBreakup)) {
                  for (const comp of sBreakup) {
                    if (comp.isTaxable !== false) {
                      monthlyTaxableGross += Number(comp.amount || 0);
                    }
                  }
                }
              }

              if (detail.allowanceBreakup) {
                const aBreakup = typeof detail.allowanceBreakup === 'string'
                  ? JSON.parse(detail.allowanceBreakup)
                  : (detail.allowanceBreakup as any);
                if (Array.isArray(aBreakup)) {
                  for (const allow of aBreakup) {
                    if (allow.isTaxable === true) {
                      monthlyTaxableGross += Number(allow.amount || 0);
                    }
                  }
                }
              }

              const finalTaxableGross = monthlyTaxableGross > 0 ? monthlyTaxableGross : (detail.grossSalary !== null ? Number(detail.grossSalary) : 0);

              // Recalculate monthly tax using tax slabs and remaining months in tax year
              let newMonthlyTax = 0;
              let calculatedAnnualTax = 0;
              if (newTaxableAnnual > 0) {
                const slab = allTaxSlabs
                  .sort((a, b) => Number(b.minAmount) - Number(a.minAmount))
                  .find(
                    (s) =>
                      newTaxableAnnual >= Number(s.minAmount) &&
                      (s.maxAmount === null || newTaxableAnnual <= Number(s.maxAmount)),
                  );

                if (slab) {
                  const fixedAmount = Number(slab.fixedAmount || 0);
                  const rate = Number(slab.rate || 0);
                  const minAmount = Number(slab.minAmount || 0);

                  const excess = newTaxableAnnual - minAmount;
                  const percentageTax = excess * (rate / 100);
                  const annualTax = fixedAmount + percentageTax;
                  calculatedAnnualTax = annualTax;

                  // Determine tax year boundaries and compute previous periods in tax year
                  const monthNum = Number(monthStr);
                  const yearNum = Number(yearStr);

                  const previousPeriods: string[] = [];
                  let loopMonth = 7; // July
                  let loopYear = monthNum >= 7 ? yearNum : yearNum - 1;
                  
                  while (true) {
                    if (loopYear > yearNum || (loopYear === yearNum && loopMonth >= monthNum)) {
                      break;
                    }
                    previousPeriods.push(`${loopYear}-${String(loopMonth).padStart(2, '0')}`);
                    loopMonth++;
                    if (loopMonth > 12) {
                      loopMonth = 1;
                      loopYear++;
                    }
                  }

                  // Sum YTD tax paid from previous CPR records
                  let ytdTaxDeducted = 0;
                  if (previousPeriods.length > 0) {
                    const previousCprs = await this.prisma.cprTax.findMany({
                      where: {
                        employeeId: detail.employeeId,
                        taxPeriod: { in: previousPeriods }
                      }
                    });
                    for (const pCpr of previousCprs) {
                      ytdTaxDeducted += Number(pCpr.taxAmountMonthlyTax || 0);
                    }
                  }

                  // Calculate remaining months in the tax year (including current month)
                  let taxMonthNum = 0;
                  if (monthNum >= 7) {
                    taxMonthNum = monthNum - 6; // July = 1, August = 2, September = 3, etc.
                  } else {
                    taxMonthNum = monthNum + 6; // January = 7, February = 8, etc.
                  }
                  const remainingMonths = 13 - taxMonthNum;

                  const remainingTax = annualTax - ytdTaxDeducted;
                  newMonthlyTax = Math.round(remainingTax / remainingMonths);
                  if (newMonthlyTax < 0) {
                    newMonthlyTax = 0;
                  }
                }
              }

              // Save/Update in CprTax table in database for this specific month record
              await this.prisma.cprTax.update({
                where: { id: cprRecord.id },
                data: {
                  taxableAmountAnnual: newTaxableAnnual,
                  taxableAmountGross: finalTaxableGross,
                  taxAmountMonthlyTax: newMonthlyTax,
                  taxAmountAnnual: Math.round(calculatedAnnualTax),
                  paymentDate: detail.paymentDate || cprRecord.paymentDate,
                }
              });
            }
          }
        }
      }

      // Return only the CprTax records for these periods
      return this.prisma.cprTax.findMany({
        where: { taxPeriod: { in: periods } },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
            }
          }
        },
        orderBy: {
          createdAt: 'desc',
        }
      });
    }

    // Default (no filter): return all records in the table
    return this.prisma.cprTax.findMany({
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            employeeName: true,
          }
        }
      },
      orderBy: {
        createdAt: 'desc',
      }
    });
  }

  async get(id: string) {
    this.prisma.ensureTenantContext();
    const record = await this.prisma.cprTax.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            employeeName: true,
          }
        }
      }
    });
    if (!record) {
      throw new NotFoundException(`CPR Tax record with ID ${id} not found`);
    }
    return record;
  }

  async update(id: string, data: UpdateCprDto) {
    this.prisma.ensureTenantContext();
    // Verify existence
    await this.get(id);

    return this.prisma.cprTax.update({
      where: { id },
      data: {
        employeeId: data.employeeId !== undefined ? (data.employeeId || null) : undefined,
        cnic: data.cnic !== undefined ? data.cnic : undefined,
        name: data.name !== undefined ? data.name : undefined,
        city: data.city !== undefined ? (data.city || null) : undefined,
        cprNo: data.cprNo !== undefined ? data.cprNo : undefined,
        carAmount: data.carAmount !== undefined ? (data.carAmount || null) : undefined,
        ntn: data.ntn !== undefined ? (data.ntn || null) : undefined,
        taxableAmountAnnual: data.taxableAmountAnnual !== undefined ? (data.taxableAmountAnnual || null) : undefined,
        taxableAmountGross: data.taxableAmountGross !== undefined ? (data.taxableAmountGross || null) : undefined,
        taxAmountMonthlyTax: data.taxAmountMonthlyTax !== undefined ? (data.taxAmountMonthlyTax || null) : undefined,
        taxAmountAnnual: data.taxAmountAnnual !== undefined ? (data.taxAmountAnnual || null) : undefined,
        taxPeriod: data.taxPeriod !== undefined ? (data.taxPeriod || null) : undefined,
        paymentDate: data.paymentDate !== undefined ? (data.paymentDate ? new Date(data.paymentDate) : null) : undefined,
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            employeeName: true,
          }
        }
      }
    });
  }

  async delete(id: string) {
    this.prisma.ensureTenantContext();
    await this.get(id);
    await this.prisma.cprTax.delete({
      where: { id }
    });
    return { success: true, message: 'CPR Tax record deleted successfully' };
  }

  async preview(filters: PreviewCprDto) {
    this.prisma.ensureTenantContext();

    const monthStr = String(Number(filters.month)).padStart(2, '0');
    const yearStr = String(filters.year);
    const targetPeriod = `${yearStr}-${monthStr}`;

    // 1. Fetch active tax slabs
    const allTaxSlabs = await this.prisma.taxSlab.findMany({
      where: { status: 'active', isDeleted: false },
    });

    // 2. Fetch confirmed or available payroll for the target period
    const payroll = await this.prisma.payroll.findFirst({
      where: {
        month: monthStr,
        year: yearStr,
      },
      include: {
        details: {
          include: {
            employee: {
              select: {
                id: true,
                employeeId: true,
                employeeName: true,
                cnicNumber: true,
                departmentId: true,
                subDepartmentId: true,
                locationId: true,
                city: {
                  select: { name: true },
                },
              },
            },
          },
        },
      },
    });

    if (!payroll || !payroll.details || payroll.details.length === 0) {
      return [];
    }

    // Filter details by department, subDepartment, location, or employeeIds
    let filteredDetails = payroll.details;

    if (filters.employeeIds && filters.employeeIds.length > 0) {
      const empSet = new Set(filters.employeeIds);
      filteredDetails = filteredDetails.filter((d) => empSet.has(d.employeeId));
    } else {
      if (filters.departmentId && filters.departmentId !== 'all') {
        filteredDetails = filteredDetails.filter(
          (d) => d.employee?.departmentId === filters.departmentId,
        );
      }
      if (filters.subDepartmentId && filters.subDepartmentId !== 'all') {
        filteredDetails = filteredDetails.filter(
          (d) => d.employee?.subDepartmentId === filters.subDepartmentId,
        );
      }
      if (filters.locationId && filters.locationId !== 'all') {
        filteredDetails = filteredDetails.filter(
          (d) => d.employee?.locationId === filters.locationId,
        );
      }
    }

    const previewList: any[] = [];


    for (const detail of filteredDetails) {
      // Find existing CPR record or baseline
      const existingCpr = await this.prisma.cprTax.findFirst({
        where: {
          employeeId: detail.employeeId,
          taxPeriod: targetPeriod,
        },
      });

      const baselineRecord = await this.prisma.cprTax.findFirst({
        where: {
          employeeId: detail.employeeId,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      const employee = detail.employee;

      // Determine Taxpayer details
      const name = existingCpr?.name || baselineRecord?.name || employee?.employeeName || '—';
      const cnic = existingCpr?.cnic || baselineRecord?.cnic || employee?.cnicNumber || '—';
      const city = existingCpr?.city || baselineRecord?.city || employee?.city?.name || '—';
      const cprNo =
        existingCpr?.cprNo && existingCpr.cprNo !== '—'
          ? existingCpr.cprNo
          : baselineRecord?.cprNo && baselineRecord.cprNo !== '—'
          ? baselineRecord.cprNo
          : `CPR-${yearStr}${monthStr}-${(employee?.employeeId || detail.employeeId).slice(-4).toUpperCase()}`;
      const ntn = existingCpr?.ntn || baselineRecord?.ntn || '—';

      const carAmountVal =
        existingCpr?.carAmount !== null && existingCpr?.carAmount !== undefined
          ? Number(existingCpr.carAmount)
          : baselineRecord?.carAmount !== null && baselineRecord?.carAmount !== undefined
          ? Number(baselineRecord.carAmount)
          : 0;

      // Base annual taxable income from payroll
      let baseAnnualTaxable = 0;
      let carBenefitInBreakup = 0;
      if (detail.taxBreakup) {
        const breakup =
          typeof detail.taxBreakup === 'string'
            ? JSON.parse(detail.taxBreakup)
            : (detail.taxBreakup as any);
        if (breakup && breakup.taxableIncome !== undefined) {
          baseAnnualTaxable = Number(breakup.taxableIncome || 0);
        }
        if (breakup && breakup.carBenefit !== undefined) {
          carBenefitInBreakup = Number(breakup.carBenefit || 0);
        }
      }

      const carBenefit = carAmountVal * 0.05;
      // Avoid double adding car perk if it's already in payroll taxBreakup.taxableIncome
      const newTaxableAnnual = (baseAnnualTaxable - carBenefitInBreakup) + carBenefit;


      // Calculate monthly taxable gross
      let monthlyTaxableGross = 0;
      if (detail.salaryBreakup) {
        const sBreakup =
          typeof detail.salaryBreakup === 'string'
            ? JSON.parse(detail.salaryBreakup)
            : (detail.salaryBreakup as any);
        if (Array.isArray(sBreakup)) {
          for (const comp of sBreakup) {
            if (comp.isTaxable !== false) {
              monthlyTaxableGross += Number(comp.amount || 0);
            }
          }
        }
      }

      if (detail.allowanceBreakup) {
        const aBreakup =
          typeof detail.allowanceBreakup === 'string'
            ? JSON.parse(detail.allowanceBreakup)
            : (detail.allowanceBreakup as any);
        if (Array.isArray(aBreakup)) {
          for (const allow of aBreakup) {
            if (allow.isTaxable === true) {
              monthlyTaxableGross += Number(allow.amount || 0);
            }
          }
        }
      }

      const finalTaxableGross =
        monthlyTaxableGross > 0
          ? monthlyTaxableGross
          : detail.grossSalary !== null
          ? Number(detail.grossSalary)
          : 0;

      // Find tax slab
      let newMonthlyTax = 0;
      let calculatedAnnualTax = 0;
      let matchedSlab: any = null;

      if (newTaxableAnnual > 0) {
        const slab = allTaxSlabs
          .sort((a, b) => Number(b.minAmount) - Number(a.minAmount))
          .find(
            (s) =>
              newTaxableAnnual >= Number(s.minAmount) &&
              (s.maxAmount === null || newTaxableAnnual <= Number(s.maxAmount)),
          );

        if (slab) {
          matchedSlab = slab;
          const fixedAmount = Number(slab.fixedAmount || 0);
          const rate = Number(slab.rate || 0);
          const minAmount = Number(slab.minAmount || 0);

          const excess = newTaxableAnnual - minAmount;
          const percentageTax = excess * (rate / 100);
          calculatedAnnualTax = fixedAmount + percentageTax;

          // Determine previous periods in fiscal year
          const monthNum = Number(monthStr);
          const yearNum = Number(yearStr);
          const previousPeriods: string[] = [];
          let loopMonth = 7;
          let loopYear = monthNum >= 7 ? yearNum : yearNum - 1;

          while (true) {
            if (loopYear > yearNum || (loopYear === yearNum && loopMonth >= monthNum)) {
              break;
            }
            previousPeriods.push(`${loopYear}-${String(loopMonth).padStart(2, '0')}`);
            loopMonth++;
            if (loopMonth > 12) {
              loopMonth = 1;
              loopYear++;
            }
          }

          let ytdTaxDeducted = 0;
          if (previousPeriods.length > 0) {
            const previousCprs = await this.prisma.cprTax.findMany({
              where: {
                employeeId: detail.employeeId,
                taxPeriod: { in: previousPeriods },
              },
            });
            for (const pCpr of previousCprs) {
              ytdTaxDeducted += Number(pCpr.taxAmountMonthlyTax || 0);
            }
          }

          let taxMonthNum = monthNum >= 7 ? monthNum - 6 : monthNum + 6;
          const remainingMonths = 13 - taxMonthNum;
          const remainingTax = calculatedAnnualTax - ytdTaxDeducted;
          newMonthlyTax = Math.max(0, Math.round(remainingTax / remainingMonths));
        }
      }

      const monthNum = Number(monthStr);
      let taxMonthNum = monthNum >= 7 ? monthNum - 6 : monthNum + 6;
      const remainingMonths = 13 - taxMonthNum;

      // Sum YTD tax deducted from previous CPR records
      let ytdTaxDeducted = 0;
      const yearNum = Number(yearStr);
      const previousPeriods: string[] = [];
      let loopMonth = 7;
      let loopYear = monthNum >= 7 ? yearNum : yearNum - 1;
      while (true) {
        if (loopYear > yearNum || (loopYear === yearNum && loopMonth >= monthNum)) {
          break;
        }
        previousPeriods.push(`${loopYear}-${String(loopMonth).padStart(2, '0')}`);
        loopMonth++;
        if (loopMonth > 12) {
          loopMonth = 1;
          loopYear++;
        }
      }
      if (previousPeriods.length > 0) {
        const previousCprs = await this.prisma.cprTax.findMany({
          where: {
            employeeId: detail.employeeId,
            taxPeriod: { in: previousPeriods },
          },
        });
        for (const pCpr of previousCprs) {
          ytdTaxDeducted += Number(pCpr.taxAmountMonthlyTax || 0);
        }
      }

      previewList.push({
        id: existingCpr?.id || undefined,
        employeeId: detail.employeeId,
        employeeCode: employee?.employeeId || '—',
        employeeName: employee?.employeeName || '—',
        name,
        cnic,
        city: city !== '—' ? city : null,
        cprNo,
        ntn: ntn !== '—' ? ntn : null,
        carAmount: carAmountVal,
        carBenefit,
        baseAnnualTaxable,
        taxableAmountAnnual: newTaxableAnnual,
        taxableAmountGross: finalTaxableGross,
        taxAmountAnnual: Math.round(calculatedAnnualTax),
        taxAmountMonthlyTax: newMonthlyTax,
        taxPeriod: targetPeriod,
        paymentDate: detail.paymentDate || existingCpr?.paymentDate || null,
        ytdTaxDeducted,
        remainingMonths,
        slab: matchedSlab
          ? {
              minAmount: Number(matchedSlab.minAmount || 0),
              maxAmount: matchedSlab.maxAmount !== null ? Number(matchedSlab.maxAmount) : null,
              rate: Number(matchedSlab.rate || 0),
              fixedAmount: Number(matchedSlab.fixedAmount || 0),
            }
          : null,
      });
    }

    return previewList;
  }

  async confirmBatch(dto: ConfirmBatchCprDto) {
    this.prisma.ensureTenantContext();

    const results: any[] = [];
    for (const record of dto.records) {
      let existing: any = null;
      if (record.employeeId) {

        existing = await this.prisma.cprTax.findFirst({
          where: {
            employeeId: record.employeeId,
            taxPeriod: dto.taxPeriod,
          },
        });
      }

      if (existing) {
        const updated = await this.prisma.cprTax.update({
          where: { id: existing.id },
          data: {
            cnic: record.cnic,
            name: record.name,
            city: record.city || null,
            cprNo: record.cprNo,
            carAmount: record.carAmount !== undefined ? record.carAmount : null,
            ntn: record.ntn || null,
            taxableAmountAnnual: record.taxableAmountAnnual !== undefined ? record.taxableAmountAnnual : null,
            taxableAmountGross: record.taxableAmountGross !== undefined ? record.taxableAmountGross : null,
            taxAmountMonthlyTax: record.taxAmountMonthlyTax !== undefined ? record.taxAmountMonthlyTax : null,
            taxAmountAnnual: record.taxAmountAnnual !== undefined ? record.taxAmountAnnual : null,
            paymentDate: record.paymentDate ? new Date(record.paymentDate) : null,
          },
        });
        results.push(updated);
      } else {
        const created = await this.prisma.cprTax.create({
          data: {
            employeeId: record.employeeId || null,
            cnic: record.cnic,
            name: record.name,
            city: record.city || null,
            cprNo: record.cprNo,
            carAmount: record.carAmount !== undefined ? record.carAmount : null,
            ntn: record.ntn || null,
            taxableAmountAnnual: record.taxableAmountAnnual !== undefined ? record.taxableAmountAnnual : null,
            taxableAmountGross: record.taxableAmountGross !== undefined ? record.taxableAmountGross : null,
            taxAmountMonthlyTax: record.taxAmountMonthlyTax !== undefined ? record.taxAmountMonthlyTax : null,
            taxAmountAnnual: record.taxAmountAnnual !== undefined ? record.taxAmountAnnual : null,
            taxPeriod: dto.taxPeriod,
            paymentDate: record.paymentDate ? new Date(record.paymentDate) : null,
          },
        });
        results.push(created);
      }
    }

    return {
      status: true,
      count: results.length,
      message: `Successfully confirmed ${results.length} CPR Tax records for period ${dto.taxPeriod}`,
    };
  }
}

