import {
  Injectable,
  BadRequestException,
  Logger,
  InternalServerErrorException,
  Inject,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../database/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { Prisma } from '@prisma/client';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Decimal } from '@prisma/client/runtime/client';

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaMaster: PrismaMasterService,
    private readonly activityLogsService: ActivityLogsService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,

    private readonly notificationsService: NotificationsService,
  ) { }

  async previewPayroll(month: string, year: string, employeeIds?: string[]) {
    this.logger.log(`Previewing payroll for ${month}/${year}`);

    // Normalize month to "01"-"12" format for consistent querying
    const normalizedMonth = String(Number(month)).padStart(2, '0');
    const normalizedYear = String(year);

    // 1. Fetch active employees (Try Redis Cache first)
    const cacheKey = 'employees_list';
    const cachedData: any = await this.cacheManager.get(cacheKey);

    let employees: any[] = [];
    if (!employeeIds?.length && cachedData) {
      employees = cachedData.filter((e: any) => e.status === 'active');
    } else {
      const where: Prisma.EmployeeWhereInput = { status: 'active' };
      if (employeeIds && employeeIds.length > 0) {
        where.id = { in: employeeIds };
      }
      // Fetch minimal employee data needed
      employees = await this.prisma.employee.findMany({
        where,
        select: {
          id: true,
          employeeId: true,
          employeeName: true,
          departmentId: true,
          subDepartmentId: true,
          designationId: true,
          employeeGradeId: true,
          workingHoursPolicyId: true,
          leavesPolicyId: true,
          socialSecurityInstitutionId: true,
          providentFund: true,
          eobi: true,
          status: true,
          joiningDate: true,
          probationExpiryDate: true,
          employeeSalary: true,
          overtimeApplicable: true,
        },
      });
    }

    if (employees.length === 0) {
      throw new BadRequestException(
        'No active employees found to generate payroll for.',
      );
    }

    const ids = employees.map((e) => e.id);
    const monthEndDate = new Date(Number(year), Number(month), 0);
    const monthStartDate = new Date(`${normalizedYear}-${normalizedMonth}-01`);

    // 2. Fetch all transactional and Master data in parallel
    const [
      salaryBreakups,
      allowances,
      deductions,
      loanRequests,
      advanceSalaries,
      leaveEncashments,
      bonuses,
      rebates,
      leaveApplications,
      increments,
      ssRegistrations,
      workingHoursPolicies,
      leavesPolicies,
      allowanceHeads,
      deductionHeads,
      bonusTypes,
      rebateNatures,
      allHolidays,
      allTaxSlabs,
      policyAssignments,
    ] = await Promise.all([
      this.prisma.salaryBreakup.findMany({ where: { status: 'active' } }),
      this.prisma.allowance.findMany({
        where: {
          employeeId: { in: ids },
          status: 'active',
          month: normalizedMonth,
          year: normalizedYear,
        },
      }),
      this.prisma.deduction.findMany({
        where: {
          employeeId: { in: ids },
          status: 'active',
          month: normalizedMonth,
          year: normalizedYear,
        },
      }),
      this.prisma.loanRequest.findMany({
        where: {
          employeeId: { in: ids },
          OR: [{ approvalStatus: 'approved' }, { status: 'approved' }],
        },
      }),
      this.prisma.advanceSalary.findMany({
        where: {
          employeeId: { in: ids },
          approvalStatus: 'approved',
          status: 'active',
        },
      }),
      this.prisma.leaveEncashment.findMany({
        where: {
          employeeId: { in: ids },
          approvalStatus: 'approved',
          status: 'active',
          paymentMonth: normalizedMonth,
          paymentYear: normalizedYear,
        },
      }),
      this.prisma.bonus.findMany({
        where: {
          employeeId: { in: ids },
          bonusMonth: normalizedMonth,
          bonusYear: normalizedYear,
          status: 'active',
        },
      }),
      this.prisma.rebate.findMany({
        where: {
          employeeId: { in: ids },
          monthYear: `${normalizedYear}-${normalizedMonth}`,
          status: 'approved',
        },
      }),
      this.prisma.leaveApplication.findMany({
        where: {
          employeeId: { in: ids },
          status: 'approved',
          OR: [
            {
              fromDate: { lte: monthEndDate },
              toDate: { gte: monthStartDate },
            },
          ],
        },
        select: {
          id: true,
          fromDate: true,
          toDate: true,
          status: true,
          employeeId: true,
        },
      }),
      this.prisma.increment.findMany({
        where: {
          employeeId: { in: ids },
          status: 'active',
          promotionDate: { lte: monthEndDate },
        },
        orderBy: { promotionDate: 'asc' },
      }),
      this.prisma.socialSecurityEmployeeRegistration.findMany({
        where: { employeeId: { in: ids }, status: 'active' },
        include: {
          institution: {
            select: { id: true, name: true, contributionRate: true },
          },
        },
        orderBy: { registrationDate: 'desc' },
      }),
      this.prisma.workingHoursPolicy.findMany({
        where: { status: 'active' },
      }),
      this.prisma.leavesPolicy.findMany({
        where: { status: 'active' },
        include: { leaveTypes: true },
      }),
      this.prisma.allowanceHead.findMany({
        select: { id: true, name: true },
      }),
      this.prisma.deductionHead.findMany({
        select: { id: true, name: true },
      }),
      this.prisma.bonusType.findMany({
        select: { id: true, name: true },
      }),
      this.prisma.rebateNature.findMany(),
      this.prisma.holiday.findMany({ where: { status: 'active' } }),
      this.prisma.taxSlab.findMany({ where: { status: 'active' } }),
      this.prisma.workingHoursPolicyAssignment.findMany({
        where: {
          employeeId: { in: ids },
          // Fetch assignments that overlap with the payroll month
          OR: [
            {
              startDate: { lte: monthEndDate },
              endDate: { gte: monthStartDate },
            },
          ],
        },
        orderBy: { startDate: 'asc' },
      }),
    ]);

    // Create maps for Master data types
    const workingHoursPolicyMap = new Map(
      workingHoursPolicies.map((p) => [p.id, p]),
    );
    const leavesPolicyMap = new Map(leavesPolicies.map((p) => [p.id, p]));
    const allowanceHeadMap = new Map(allowanceHeads.map((h) => [h.id, h]));
    const deductionHeadMap = new Map(deductionHeads.map((h) => [h.id, h]));
    const bonusTypeMap = new Map(bonusTypes.map((t) => [t.id, t]));
    const rebateNatureMap = new Map(rebateNatures.map((n) => [n.id, n]));

    // 3. Map relations to employees to create enriched employee objects
    const enrichedEmployees = employees.map((emp) => ({
      ...emp,
      workingHoursPolicy: workingHoursPolicyMap.get(emp.workingHoursPolicyId),
      leavesPolicy: leavesPolicyMap.get(emp.leavesPolicyId),
      socialSecurityRegistrations: ssRegistrations.filter(
        (r) => r.employeeId === emp.id,
      ),
      allowances: allowances
        .filter((a) => a.employeeId === emp.id)
        .map((a) => ({
          ...a,
          allowanceHead: allowanceHeadMap.get(a.allowanceHeadId),
        })),
      deductions: deductions
        .filter((d) => d.employeeId === emp.id)
        .map((d) => ({
          ...d,
          deductionHead: deductionHeadMap.get(d.deductionHeadId),
        })),
      loanRequests: loanRequests.filter((l) => l.employeeId === emp.id),
      advanceSalaries: advanceSalaries.filter((as) => as.employeeId === emp.id),
      leaveEncashments: leaveEncashments.filter(
        (le) => le.employeeId === emp.id,
      ),
      bonuses: bonuses
        .filter((b) => b.employeeId === emp.id)
        .map((b) => ({ ...b, bonusType: bonusTypeMap.get(b.bonusTypeId) })),
      rebates: rebates
        .filter((r) => r.employeeId === emp.id)
        .map((r) => ({
          ...r,
          rebateNature: rebateNatureMap.get(r.rebateNatureId),
        })),
      leaveApplications: leaveApplications.filter(
        (la) => la.employeeId === emp.id,
      ),
      increments: increments.filter((inc) => inc.employeeId === emp.id),
      policyAssignments: policyAssignments
        .filter((pa) => pa.employeeId === emp.id)
        .map((pa) => ({
          ...pa,
          workingHoursPolicy: workingHoursPolicyMap.get(
            pa.workingHoursPolicyId,
          ),
        })),
    }));

    const previewData: any[] = []; // Explicitly type as any[] or define an interface

    for (const employee of enrichedEmployees) {
      // Type cast to any to handle Prisma relations that may not be in generated types yet
      const emp = employee as any;
      const monthStartDate = new Date(
        `${normalizedYear}-${normalizedMonth}-01`,
      );
      const monthEndDate = new Date(
        Number(normalizedYear),
        Number(normalizedMonth),
        0,
      );
      const totalDaysInMonth = monthEndDate.getDate();

      // Calculate effective salary considering increments/decrements during the month
      const { effectivePackage, incrementBreakup } =
        this.calculateEffectiveSalary(
          employee,
          monthStartDate,
          monthEndDate,
          totalDaysInMonth,
        );

      // "effectivePackage" is the effective monthly package considering increments/decrements
      const packageAmount = effectivePackage;

      // Calculate breakup components using effective package
      // Parse details to get component-level taxability information
      const salaryBreakup = salaryBreakups.map((breakup) => {
        let amount = new Decimal(0);
        let isTaxable = true;

        // Parse details JSON to check if this component is explicitly marked as non-taxable
        try {
          if (breakup.details) {
            const details =
              typeof breakup.details === 'string'
                ? JSON.parse(breakup.details)
                : breakup.details;
            if (Array.isArray(details) && details.length > 0) {
              // If details is an array, find the entry matching this breakup's name
              const matchingEntry = details.find(
                (entry: any) => entry.typeName === breakup.name,
              );
              if (matchingEntry && matchingEntry.isTaxable === false) {
                isTaxable = false;
              }
            } else if (
              typeof details === 'object' &&
              details.isTaxable === false
            ) {
              // If details is an object with isTaxable property
              isTaxable = false;
            }
          }
        } catch (e) {
          // If parsing fails, default to taxable
          isTaxable = true;
        }

        // Override: Ensure 'Take Home Salary' is always taxable as per user request
        if (breakup.name.trim() === 'Take Home Salary') {
          isTaxable = true;
        }

        if (breakup.percentage !== null && breakup.percentage !== undefined) {
          amount = packageAmount.mul(new Decimal(breakup.percentage)).div(100);
        }
        return {
          id: breakup.id,
          name: breakup.name,
          percentage: breakup.percentage
            ? new Decimal(breakup.percentage).toNumber()
            : null,
          amount: Math.round(amount.toNumber()), // Round to whole number (no decimals)
          isTaxable: isTaxable,
          isRecurring: true, // Salary components are always recurring
        };
      });

      // Adjust the last component to ensure total equals packageAmount exactly (no rounding errors)
      if (salaryBreakup.length > 0) {
        const calculatedTotal = salaryBreakup.reduce(
          (sum, component) => sum + component.amount,
          0,
        );
        const packageAmountRounded = Math.round(packageAmount.toNumber());
        const difference = packageAmountRounded - calculatedTotal;

        if (difference !== 0 && salaryBreakup.length > 0) {
          // Add the difference to the last component to ensure exact total
          salaryBreakup[salaryBreakup.length - 1].amount += difference;
        }
      }

      // Find "Basic Salary" component for rate calculations
      const basicComponent = salaryBreakup.find(
        (b) => b.name === 'Basic Salary',
      );
      const calculatedBasicSalary = basicComponent
        ? new Decimal(basicComponent.amount)
        : packageAmount; // Fallback to package if no basic defined

      // Calculate total package amount (sum of all salary breakup components)
      const salaryBreakupTotal = salaryBreakup.reduce(
        (sum, component) => sum + (component.amount || 0),
        0,
      );
      const totalPackageAmount =
        salaryBreakupTotal > 0
          ? new Decimal(salaryBreakupTotal)
          : packageAmount;

      // A. Calculate Allowances (Ad-hoc additional allowances)
      let totalAdHocAllowances = this.calculateAllowances(emp.allowances || []);

      // Prepare allowance breakdown (only allowances with paymentMethod 'with_salary')
      const allowanceBreakup = (emp.allowances || [])
        .filter((allow: any) => allow.paymentMethod === 'with_salary')
        .map((allow: any) => ({
          id: allow.id,
          name: allow.allowanceHead?.name || 'Unknown',
          amount: Number(allow.amount),
          isTaxable: allow.isTaxable,
          taxPercentage: allow.taxPercentage
            ? Number(allow.taxPercentage)
            : null,
          isRecurring: allow.type === 'recurring', // Honor the allowance type
        }));

      // Calculate Social Security Contribution as an addition/allowance
      // Prefer explicit employee social security institution; fallback to latest registration's institution
      let socialSecurityContributionAmount = new Decimal(0);
      let socialSecurityRate: Decimal | null = null;
      if (
        emp.socialSecurityInstitution &&
        emp.socialSecurityInstitution.contributionRate
      ) {
        socialSecurityRate = new Decimal(
          emp.socialSecurityInstitution.contributionRate,
        );
      } else if (
        emp.socialSecurityRegistrations &&
        emp.socialSecurityRegistrations.length > 0
      ) {
        const latestReg = emp.socialSecurityRegistrations[0];
        if (latestReg.institution && latestReg.institution.contributionRate) {
          socialSecurityRate = new Decimal(
            latestReg.institution.contributionRate,
          );
        }
      }

      if (socialSecurityRate && socialSecurityRate.gt(0)) {
        // SSI base calculation: Basic Salary + House Rent + Utility
        const ssiComponentNames = ['Basic Salary', 'House Rent', 'Utility'];
        const ssiBase = salaryBreakup
          .filter((comp) =>
            ssiComponentNames.some(
              (name) => comp.name.trim().toLowerCase() === name.toLowerCase(),
            ),
          )
          .reduce(
            (sum, comp) => sum.add(new Decimal(comp.amount)),
            new Decimal(0),
          );

        socialSecurityContributionAmount = ssiBase
          .mul(socialSecurityRate)
          .div(100);

        if (socialSecurityContributionAmount.gt(0)) {
          // Add to allowance breakup so it flows into Gross and Net salary
          allowanceBreakup.push({
            id: 'social-security-contribution',
            name: 'Social Security',
            amount: Math.round(socialSecurityContributionAmount.toNumber()),
            isTaxable: false, // Social security is typically not taxed
            taxPercentage: null,
            isRecurring: true,
          });
          totalAdHocAllowances = totalAdHocAllowances.add(
            Math.round(socialSecurityContributionAmount.toNumber()),
          );
        }
      }

      // B. Calculate Overtime (Using calculated Basic Salary for rate)
      // Include overtime from both overtimeRequests and attendance records (holidays/weekends)
      const { overtimeAmount, overtimeBreakup } = await this.calculateOvertime(
        employee,
        month,
        year,
        emp.workingHoursPolicy,
        emp.policyAssignments, // Pass assignments
        calculatedBasicSalary,
        monthStartDate,
        monthEndDate,
        allHolidays,
      );

      // C. Calculate Attendance Deductions (Lates/Absents) (using total package amount, not just basic salary)
      const { attendanceDeduction, attendanceBreakup } =
        await this.calculateAttendanceDeductions(
          employee,
          month,
          year,
          emp.workingHoursPolicy,
          emp.policyAssignments, // Pass assignments
          totalPackageAmount,
          allHolidays,
        );

      // D. Calculate Bonuses
      const bonusAmount = this.calculateBonuses(emp.bonuses || []);

      // Prepare bonus breakdown (only bonuses with paymentMethod 'with_salary')
      const bonusBreakup = (emp.bonuses || [])
        .filter((b) => b.paymentMethod === 'with_salary')
        .map((bonus) => ({
          id: bonus.id,
          name: bonus.bonusType?.name || 'Unknown',
          amount: Number(bonus.amount),
          calculationType: bonus.calculationType,
          percentage: bonus.percentage ? Number(bonus.percentage) : null,
          isTaxable: bonus.isTaxable,
          taxPercentage: bonus.taxPercentage
            ? Number(bonus.taxPercentage)
            : null,
          isRecurring: false, // Bonuses are always one-time
        }));

      // D1. Calculate Leave Encashment
      const leaveEncashmentAmount = this.calculateLeaveEncashment(
        emp.leaveEncashments || [],
      );

      // Prepare deduction breakdown (excluding tax, attendance, loan, advance, eobi, pf which are calculated separately)
      const deductionBreakup = (emp.deductions || []).map((ded: any) => ({
        id: ded.id,
        name: ded.deductionHead?.name || 'Unknown',
        amount: Number(ded.amount),
        isTaxable: ded.isTaxable,
        taxPercentage: ded.taxPercentage ? Number(ded.taxPercentage) : null,
      }));

      // E. Calculate Gross Salary (Pre-tax)
      // Gross = Sum of Salary Breakup Components + AdHoc Allowances + Overtime + Bonus + Leave Encashment
      // Use already calculated totalPackageAmount (which is salaryBreakupTotal as Decimal)
      const grossSalary = totalPackageAmount
        .add(totalAdHocAllowances)
        .add(overtimeAmount)
        .add(bonusAmount)
        .add(leaveEncashmentAmount);

      // F. Calculate Tax (with Rebates)
      // Tax is calculated based on taxable components from salary, allowances, and bonuses
      // Combine all taxable components
      const allTaxableComponents = [
        ...salaryBreakup,
        ...allowanceBreakup,
        ...bonusBreakup,
      ];
      const { taxDeduction, taxBreakup } = await this.calculateTax(
        allTaxableComponents,
        emp.rebates || [],
        packageAmount,
        allTaxSlabs,
      );

      // G. Calculate EOBI & PF
      // PF should only be calculated from salary components (Basic Salary, House Rent, Utility, etc.)
      // NOT from allowances, bonuses, or leave encashment
      const { eobiDeduction, providentFundDeduction } =
        await this.calculateEOBI_PF(employee, month, year, totalPackageAmount);

      // H. Calculate Loans & Advances
      const { loanDeduction, advanceSalaryDeduction } =
        this.calculateLoansAndAdvances(
          employee,
          normalizedMonth,
          normalizedYear,
        );

      // I. Other Ad-hoc Deductions
      const totalAdHocDeductions = this.calculateAdHocDeductions(
        emp.deductions || [],
      );

      // Total Deductions
      const totalDeductionsSum = attendanceDeduction
        .add(loanDeduction)
        .add(advanceSalaryDeduction)
        .add(eobiDeduction)
        .add(providentFundDeduction)
        .add(taxDeduction)
        .add(totalAdHocDeductions);

      // Net Salary
      const netSalary = grossSalary.minus(totalDeductionsSum);

      // Push to array (plain objects for frontend)
      previewData.push({
        employeeId: employee.id,
        employeeName: employee.employeeName,
        employeeCode: employee.employeeId,
        employee: {
          employeeId: employee.employeeId,
          employeeName: employee.employeeName,
          department: emp.department?.name || null,
          subDepartment: emp.subDepartment?.name || null,
          designation: emp.designation?.name || null,
          country: emp.country?.name || null,
          state: emp.state?.name || null,
          city: emp.city?.name || null,
          branch: emp.location?.name || null,
        },
        workingHoursPolicy: emp.workingHoursPolicy, // Default policy
        policyAssignments: emp.policyAssignments, // Expose for UI timeline
        basicSalary: calculatedBasicSalary.toNumber(),
        salaryBreakup,
        allowanceBreakup,
        totalAllowances: totalAdHocAllowances.toNumber(),
        overtimeBreakup,
        overtimeAmount: overtimeAmount.toNumber(),
        bonusBreakup,
        bonusAmount: bonusAmount.toNumber(),
        leaveEncashmentAmount: leaveEncashmentAmount.toNumber(),
        socialSecurityContributionAmount:
          socialSecurityContributionAmount.toNumber(),
        incrementBreakup,
        deductionBreakup,
        totalDeductions: totalAdHocDeductions.toNumber(),
        attendanceBreakup,
        attendanceDeduction: attendanceDeduction.toNumber(),
        loanDeduction: loanDeduction.toNumber(),
        advanceSalaryDeduction: advanceSalaryDeduction.toNumber(),
        eobiDeduction: eobiDeduction.toNumber(),
        providentFundDeduction: providentFundDeduction.toNumber(),
        taxBreakup,
        taxDeduction: taxDeduction.toNumber(),
        grossSalary: grossSalary.toNumber(),
        netSalary: netSalary.toNumber(),
        paymentStatus: 'pending',
      });
    }

    return previewData;
  }

  async confirmPayroll(data: {
    month: string;
    year: string;
    generatedBy: string;
    details: any[]; // Edited list from frontend
  }) {
    const { month, year, generatedBy, details } = data;
    this.logger.log(`Confirming payroll for ${month}/${year}`);

    try {
      // Fetch employees for bank info snapshot
      const employeeIds = details.map((d) => d.employeeId);
      const employeesInfo = await this.prisma.employee.findMany({
        where: { id: { in: employeeIds } },
        select: {
          id: true,
          accountNumber: true,
          bankName: true,
        },
      });

      const employeeMap = new Map(employeesInfo.map((e) => [e.id, e]));

      // Check if payroll already exists
      let payroll = await this.prisma.payroll.findFirst({
        where: {
          month,
          year,
        },
      });

      if (payroll) {
        if (payroll.status !== 'draft' && payroll.status !== 'confirmed') {
          throw new BadRequestException(
            'Payroll for this month is already processed/approved.',
          );
        }
      } else {
        // Create new payroll header if not exists
        payroll = await this.prisma.payroll.create({
          data: {
            month,
            year,
            totalAmount: 0,
            status: 'confirmed',
            generatedById: generatedBy,
          },
        });
      }

      // Remove existing details for submitted employees
      await this.prisma.payrollDetail.deleteMany({
        where: {
          payrollId: payroll.id,
          employeeId: { in: employeeIds },
        },
      });

      const payrollDetailsData: any[] = details.map((d) => {
        const empInfo = employeeMap.get(d.employeeId);
        return {
          payrollId: payroll.id,
          employeeId: d.employeeId,
          basicSalary: new Decimal(d.basicSalary),
          totalAllowances: new Decimal(d.totalAllowances),
          totalDeductions: new Decimal(d.totalDeductions),
          attendanceDeduction: new Decimal(d.attendanceDeduction),
          loanDeduction: new Decimal(d.loanDeduction),
          advanceSalaryDeduction: new Decimal(d.advanceSalaryDeduction),
          eobiDeduction: new Decimal(d.eobiDeduction),
          providentFundDeduction: new Decimal(d.providentFundDeduction),
          taxDeduction: new Decimal(d.taxDeduction),
          overtimeAmount: new Decimal(d.overtimeAmount),
          bonusAmount: new Decimal(d.bonusAmount),
          leaveEncashmentAmount: new Decimal(d.leaveEncashmentAmount || 0),
          socialSecurityContributionAmount: new Decimal(
            d.socialSecurityContributionAmount || 0,
          ),
          grossSalary: new Decimal(d.grossSalary),
          netSalary: new Decimal(d.netSalary),
          paymentStatus: 'pending',
          // Save breakdowns
          salaryBreakup: d.salaryBreakup || [],
          allowanceBreakup: d.allowanceBreakup || [],
          deductionBreakup: d.deductionBreakup || [],
          taxBreakup: d.taxBreakup || {},
          attendanceBreakup: d.attendanceBreakup || {},
          overtimeBreakup: d.overtimeBreakup || [],
          bonusBreakup: d.bonusBreakup || [],
          incrementBreakup: d.incrementBreakup || [],
          // Snapshot bank info
          accountNumber: empInfo?.accountNumber,
          bankName: empInfo?.bankName,
          paymentMode: 'Bank Transfer', // Default or fetch if available
        };
      });

      // Bulk create details
      if (payrollDetailsData.length > 0) {
        await this.prisma.payrollDetail.createMany({
          data: payrollDetailsData,
        });
      }

      // Update Total Amount
      const aggregate = await this.prisma.payrollDetail.aggregate({
        where: { payrollId: payroll.id },
        _sum: { netSalary: true },
      });

      await this.prisma.payroll.update({
        where: { id: payroll.id },
        data: {
          totalAmount: aggregate._sum.netSalary || new Decimal(0),
          status: 'confirmed',
        },
      });

      // Log Component
      await this.activityLogsService.log({
        module: 'payroll',
        action: 'generate',
        entity: 'Payroll',
        entityId: payroll.id,
        description: `Confirmed payroll for ${month}/${year}`,
        status: 'success',
        userId: generatedBy,
      });

      // Trigger Email Notifications (Async)
      this.sendPayslipEmails(payroll.id).catch((err) =>
        this.logger.error('Failed to trigger payslip emails', err),
      );

      return payroll;
    } catch (error) {
      this.logger.error(
        `Error confirming payroll: ${error.message}`,
        error.stack,
      );

      // Log failure to activity logs
      await this.activityLogsService.log({
        module: 'payroll',
        action: 'generate',
        entity: 'Payroll',
        description: `Failed to confirm payroll for ${month}/${year}: ${error.message}`,
        status: 'failure',
        userId: generatedBy,
        errorMessage: error.message,
      });

      throw error instanceof BadRequestException
        ? error
        : new InternalServerErrorException(error.message);
    }
  }

  async getPayrollById(id: string) {
    return this.prisma.payroll.findUnique({
      where: { id },
      include: { details: { include: { employee: true } } },
    });
  }

  private async sendPayslipEmails(payrollId: string) {
    const payroll = await this.prisma.payroll.findUnique({
      where: { id: payrollId },
      include: {
        details: {
          include: {
            employee: true,
          },
        },
      },
    });

    if (!payroll) return;

    // Collect IDs for Master Data fetching
    const departmentIds = new Set<string>();
    const designationIds = new Set<string>();
    const employeeIds = new Set<string>();

    payroll.details.forEach((d) => {
      if (d.employee) {
        if (d.employee.departmentId) departmentIds.add(d.employee.departmentId);
        if (d.employee.designationId)
          designationIds.add(d.employee.designationId);
        if (d.employee.employeeId) employeeIds.add(d.employee.employeeId);
      }
    });

    // Fetch Master Data
    const [departments, designations, users] = await Promise.all([
      this.prisma.department.findMany({
        where: { id: { in: Array.from(departmentIds) } },
      }),
      this.prisma.designation.findMany({
        where: { id: { in: Array.from(designationIds) } },
      }),
      this.prismaMaster.user.findMany({
        where: {
          employeeId: { in: Array.from(employeeIds) },
          status: 'active',
        },
      }),
    ]);

    const deptMap = new Map(departments.map((d) => [d.id, d]));
    const desMap = new Map(designations.map((d) => [d.id, d]));
    const userMap = new Map(users.map((u) => [u.employeeId, u]));

    for (const detail of payroll.details) {
      if (!detail.employee) continue;

      // Find mapped User by employeeId
      const user = userMap.get(detail.employee.employeeId);

      if (user) {
        // Construct composite employee object for HTML generation
        const compositeEmployee = {
          ...detail.employee,
          department: detail.employee.departmentId
            ? deptMap.get(detail.employee.departmentId)
            : null,
          designation: detail.employee.designationId
            ? desMap.get(detail.employee.designationId)
            : null,
          user: user, // Attach user if needed mostly for ID
        };
        const compositeDetail = { ...detail, employee: compositeEmployee };

        // Generate simplified HTML for email body (mimicking the slip)
        const htmlContent = this.generatePayslipHTML(
          compositeDetail,
          payroll.month,
          payroll.year,
        );

        // Use NotificationsService to create a notification record (In-App only to avoid duplicate email)
        await this.notificationsService.create({
          userId: user.id!,
          title: `Payslip for ${payroll.month}/${payroll.year}`,
          message: `Your payslip for ${payroll.month}/${payroll.year} is ready. Net Salary: ${detail.netSalary}`,
          category: 'payroll',
          priority: 'high',
          channels: ['inApp'], // Only in-app here, we send custom email below
          actionType: 'payroll.view',
          entityType: 'PayrollDetail',
          entityId: detail.id,
        });

        const emailSubject = `Payslip - ${payroll.month}/${payroll.year}`;
        await this.notificationsService.sendEmail({
          userId: user.id!,
          subject: emailSubject,
          body: htmlContent,
        });
      }
    }
  }

  private generatePayslipHTML(
    detail: any,
    month: string,
    year: string,
  ): string {
    const emp = detail.employee;
    const formatCurrency = (amount: any) =>
      new Intl.NumberFormat('en-PK', {
        style: 'currency',
        currency: 'PKR',
        minimumFractionDigits: 0,
      }).format(Number(amount));

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; color: #333; line-height: 1.4; }
          .container { max-width: 800px; margin: 0 auto; border: 1px solid #ddd; padding: 20px; }
          .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px; }
          .company-name { font-size: 24px; font-weight: bold; }
          .title { font-size: 18px; margin-top: 5px; }
          .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; }
          .row { display: flex; justify-content: space-between; margin-bottom: 5px; }
          .label { font-weight: bold; color: #555; }
          .section-title { background: #f4f4f4; padding: 5px; font-weight: bold; border-top: 1px solid #ddd; border-bottom: 1px solid #ddd; margin-top: 10px; }
          .table-row { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #eee; }
          .total-row { display: flex; justify-content: space-between; padding: 10px 0; font-weight: bold; border-top: 2px solid #333; margin-top: 10px; }
          .net-salary { background: #e8f5e9; padding: 10px; text-align: center; font-size: 20px; font-weight: bold; margin-top: 20px; border: 1px solid #c8e6c9; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="company-name">Innovative Network Pvt Ltd</div>
            <div class="title">Payslip for ${month}/${year}</div>
          </div>

          <div class="info-grid">
            <div>
              <div class="row"><span class="label">Employee Name:</span> <span>${emp.employeeName}</span></div>
              <div class="row"><span class="label">Employee ID:</span> <span>${emp.employeeId}</span></div>
              <div class="row"><span class="label">Designation:</span> <span>${emp.designation?.name || '-'}</span></div>
            </div>
            <div>
              <div class="row"><span class="label">Department:</span> <span>${emp.department?.name || '-'}</span></div>
              <div class="row"><span class="label">Date of Joining:</span> <span>${emp.joiningDate ? new Date(emp.joiningDate).toLocaleDateString() : '-'}</span></div>
              <div class="row"><span class="label">Payment Mode:</span> <span>Bank Transfer</span></div>
            </div>
          </div>

          <div style="display: flex; gap: 20px;">
            <div style="flex: 1;">
              <div class="section-title">Earnings</div>
              <div class="table-row"><span>Basic Salary</span> <span>${formatCurrency(detail.basicSalary)}</span></div>
              ${(detail.allowanceBreakup || [])
        .map(
          (a: any) => `
                <div class="table-row"><span>${a.name}</span> <span>${formatCurrency(a.amount)}</span></div>
              `,
        )
        .join('')}
              ${detail.overtimeAmount > 0 ? `<div class="table-row"><span>Overtime</span> <span>${formatCurrency(detail.overtimeAmount)}</span></div>` : ''}
              ${detail.bonusAmount > 0 ? `<div class="table-row"><span>Bonus</span> <span>${formatCurrency(detail.bonusAmount)}</span></div>` : ''}
              <div class="total-row"><span>Total Earnings</span> <span>${formatCurrency(Number(detail.basicSalary) + Number(detail.totalAllowances) + Number(detail.overtimeAmount) + Number(detail.bonusAmount))}</span></div>
            </div>

            <div style="flex: 1;">
              <div class="section-title">Deductions</div>
              ${(detail.deductionBreakup || [])
        .map(
          (d: any) => `
                <div class="table-row"><span>${d.name}</span> <span>${formatCurrency(d.amount)}</span></div>
              `,
        )
        .join('')}
              ${detail.taxDeduction > 0 ? `<div class="table-row"><span>Tax</span> <span>${formatCurrency(detail.taxDeduction)}</span></div>` : ''}
              ${detail.eobiDeduction > 0 ? `<div class="table-row"><span>EOBI</span> <span>${formatCurrency(detail.eobiDeduction)}</span></div>` : ''}
              ${detail.providentFundDeduction > 0 ? `<div class="table-row"><span>Provident Fund</span> <span>${formatCurrency(detail.providentFundDeduction)}</span></div>` : ''}
              ${detail.loanDeduction > 0 ? `<div class="table-row"><span>Loan</span> <span>${formatCurrency(detail.loanDeduction)}</span></div>` : ''}
              ${detail.advanceSalaryDeduction > 0 ? `<div class="table-row"><span>Advance Salary</span> <span>${formatCurrency(detail.advanceSalaryDeduction)}</span></div>` : ''}
              ${detail.attendanceDeduction > 0 ? `<div class="table-row"><span>Attendance/Late</span> <span>${formatCurrency(detail.attendanceDeduction)}</span></div>` : ''}
              <div class="total-row"><span>Total Deductions</span> <span>${formatCurrency(detail.totalDeductions)}</span></div>
            </div>
          </div>

          <div class="net-salary">
            Net Salary: ${formatCurrency(detail.netSalary)}
          </div>
          
          <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #777;">
            This is a computer-generated document and does not require a signature.
          </div>
        </div>
      </body>
      </html>
    `;
  }

  async getPayrollReport(filters: {
    month?: string;
    year?: string;
    departmentId?: string;
    subDepartmentId?: string;
    employeeId?: string;
  }) {
    const where: Prisma.PayrollDetailWhereInput = {};

    if (filters.month || filters.year) {
      where.payroll = {
        ...(filters.month &&
          filters.month !== 'all' && { month: filters.month }),
        ...(filters.year && filters.year !== 'all' && { year: filters.year }),
      };
    }

    if (filters.employeeId && filters.employeeId !== 'all') {
      where.employeeId = filters.employeeId;
    }

    if (
      (filters.departmentId && filters.departmentId !== 'all') ||
      (filters.subDepartmentId && filters.subDepartmentId !== 'all')
    ) {
      where.employee = {
        ...(filters.departmentId &&
          filters.departmentId !== 'all' && {
          departmentId: filters.departmentId,
        }),
        ...(filters.subDepartmentId &&
          filters.subDepartmentId !== 'all' && {
          subDepartmentId: filters.subDepartmentId,
        }),
      };
    }

    const payrollDetails = await this.prisma.payrollDetail.findMany({
      where,
      include: {
        employee: true,
        payroll: true,
      },
      orderBy: {
        employee: {
          employeeName: 'asc',
        },
      },
    });

    // Fetch Master data for all employees in parallel
    const deptIds = [
      ...new Set(
        payrollDetails.map((d: any) => d.employee.departmentId).filter(Boolean),
      ),
    ];
    const subDeptIds = [
      ...new Set(
        payrollDetails
          .map((d: any) => d.employee.subDepartmentId)
          .filter(Boolean),
      ),
    ];
    const desIds = [
      ...new Set(
        payrollDetails
          .map((d: any) => d.employee.designationId)
          .filter(Boolean),
      ),
    ];
    const cityIds = [
      ...new Set(
        payrollDetails.map((d: any) => d.employee.cityId).filter(Boolean),
      ),
    ];
    const stateIds = [
      ...new Set(
        payrollDetails.map((d: any) => d.employee.stateId).filter(Boolean),
      ),
    ];
    const countryIds = [
      ...new Set(
        payrollDetails.map((d: any) => d.employee.countryId).filter(Boolean),
      ),
    ];
    const locIds = [
      ...new Set(
        payrollDetails.map((d: any) => d.employee.locationId).filter(Boolean),
      ),
    ];

    const [
      departments,
      subDepartments,
      designations,
      cities,
      states,
      countries,
      locations,
    ] = await Promise.all([
      this.prisma.department.findMany({
        where: { id: { in: deptIds as string[] } },
      }),
      this.prisma.subDepartment.findMany({
        where: { id: { in: subDeptIds as string[] } },
      }),
      this.prisma.designation.findMany({
        where: { id: { in: desIds as string[] } },
      }),
      this.prisma.city.findMany({
        where: { id: { in: cityIds as string[] } },
      }),
      this.prisma.state.findMany({
        where: { id: { in: stateIds as string[] } },
      }),
      this.prisma.country.findMany({
        where: { id: { in: countryIds as string[] } },
      }),
      this.prisma.location.findMany({
        where: { id: { in: locIds as string[] } },
      }),
    ]);

    const deptMap = new Map(departments.map((d) => [d.id, d]));
    const subDeptMap = new Map(subDepartments.map((s) => [s.id, s]));
    const desMap = new Map(designations.map((d) => [d.id, d]));
    const cityMap = new Map(cities.map((c) => [c.id, c]));
    const stateMap = new Map(states.map((s) => [s.id, s]));
    const countryMap = new Map(countries.map((c) => [c.id, c]));
    const locMap = new Map(locations.map((l) => [l.id, l]));

    return payrollDetails.map((detail: any) => ({
      ...detail,
      employee: {
        ...detail.employee,
        department: deptMap.get(detail.employee.departmentId),
        subDepartment: detail.employee.subDepartmentId
          ? subDeptMap.get(detail.employee.subDepartmentId)
          : null,
        designation: desMap.get(detail.employee.designationId),
        city: detail.employee.cityId
          ? cityMap.get(detail.employee.cityId)
          : null,
        state: detail.employee.stateId
          ? stateMap.get(detail.employee.stateId)
          : null,
        country: detail.employee.countryId
          ? countryMap.get(detail.employee.countryId)
          : null,
        location: detail.employee.locationId
          ? locMap.get(detail.employee.locationId)
          : null,
      },
    }));
  }

  async getBankReport(filters: {
    month: string;
    year: string;
    bankName: string;
  }) {
    return this.prisma.payrollDetail.findMany({
      where: {
        bankName: filters.bankName,
        payroll: {
          month: filters.month,
          year: filters.year,
          status: { in: ['draft', 'confirmed'] }, // Show both for flexibility
        },
      },
      include: {
        employee: {
          select: {
            employeeId: true,
            employeeName: true,
          },
        },
      },
      orderBy: {
        employee: {
          employeeName: 'asc',
        },
      },
    });
  }

  async getPayslips(filters: {
    month?: string;
    year?: string;
    departmentId?: string;
    subDepartmentId?: string;
    employeeId?: string;
  }) {
    const payrollWhere: Prisma.PayrollWhereInput = {
      status: { in: ['draft', 'confirmed'] },
    };

    if (filters.month && filters.month !== 'all') {
      payrollWhere.month = filters.month;
    }
    if (filters.year && filters.year !== 'all') {
      payrollWhere.year = filters.year;
    }

    const where: Prisma.PayrollDetailWhereInput = {
      payroll: payrollWhere,
    };

    if (filters.employeeId && filters.employeeId !== 'all') {
      where.employeeId = filters.employeeId;
    }

    if (
      (filters.departmentId && filters.departmentId !== 'all') ||
      (filters.subDepartmentId && filters.subDepartmentId !== 'all')
    ) {
      where.employee = {
        ...(filters.departmentId &&
          filters.departmentId !== 'all' && {
          departmentId: filters.departmentId,
        }),
        ...(filters.subDepartmentId &&
          filters.subDepartmentId !== 'all' && {
          subDepartmentId: filters.subDepartmentId,
        }),
      };
    }

    const payrollDetails = await this.prisma.payrollDetail.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            employeeName: true,
            officialEmail: true,
            departmentId: true,
            subDepartmentId: true,
          },
        },
        payroll: true,
      },
      orderBy: {
        employee: {
          employeeName: 'asc',
        },
      },
    });

    const deptIds = [
      ...new Set(
        payrollDetails.map((d: any) => d.employee.departmentId).filter(Boolean),
      ),
    ];
    const subDeptIds = [
      ...new Set(
        payrollDetails
          .map((d: any) => d.employee.subDepartmentId)
          .filter(Boolean),
      ),
    ];

    const [departments, subDepartments] = await Promise.all([
      this.prisma.department.findMany({
        where: { id: { in: deptIds as string[] } },
        select: { id: true, name: true },
      }),
      this.prisma.subDepartment.findMany({
        where: { id: { in: subDeptIds as string[] } },
        select: { id: true, name: true },
      }),
    ]);

    const deptMap = new Map(departments.map((d) => [d.id, d]));
    const subDeptMap = new Map(subDepartments.map((s) => [s.id, s]));

    return payrollDetails.map((detail: any) => ({
      ...detail,
      employee: {
        ...detail.employee,
        department: detail.employee.departmentId
          ? deptMap.get(detail.employee.departmentId)
          : null,
        subDepartment: detail.employee.subDepartmentId
          ? subDeptMap.get(detail.employee.subDepartmentId)
          : null,
      },
    }));
  }

  async getPayslipDetail(detailId: string) {
    const detail: any = await this.prisma.payrollDetail.findUnique({
      where: { id: detailId },
      include: {
        employee: true,
        payroll: true,
      },
    });

    if (!detail) {
      throw new BadRequestException('Payslip not found');
    }

    // Fetch Master data for the employee
    const [dept, subDept, des, grade] = await Promise.all([
      detail.employee.departmentId
        ? this.prisma.department.findUnique({
          where: { id: detail.employee.departmentId },
        })
        : null,
      detail.employee.subDepartmentId
        ? this.prisma.subDepartment.findUnique({
          where: { id: detail.employee.subDepartmentId },
        })
        : null,
      detail.employee.designationId
        ? this.prisma.designation.findUnique({
          where: { id: detail.employee.designationId },
        })
        : null,
      detail.employee.employeeGradeId
        ? this.prisma.employeeGrade.findUnique({
          where: { id: detail.employee.employeeGradeId },
        })
        : null,
    ]);

    detail.employee.department = dept;
    detail.employee.subDepartment = subDept;
    detail.employee.designation = des;
    detail.employee.employeeGrade = grade;

    // 1. Calculate PF Balances
    const allPreviousDetails = await this.prisma.payrollDetail.findMany({
      where: {
        employeeId: detail.employeeId,
        payroll: {
          status: 'confirmed',
          OR: [
            { year: { lt: detail.payroll.year } },
            { year: detail.payroll.year, month: { lt: detail.payroll.month } },
          ],
        },
      },
    });

    // Sum up both employee and employer contributions (assuming matching)
    const pfOpeningBalance = allPreviousDetails.reduce(
      (sum, d) => sum.add(new Decimal(d.providentFundDeduction).mul(2)),
      new Decimal(0),
    );

    const pfAddedDuringMonth = new Decimal(detail.providentFundDeduction).mul(
      2,
    );

    // Withdrawal: Placeholder as there's no model for it yet
    const pfWithdrawalAmount = new Decimal(0);

    const pfClosingBalance = pfOpeningBalance
      .add(pfAddedDuringMonth)
      .minus(pfWithdrawalAmount);

    // 2. Calculate Loan Balances
    // Fetch all approved loan requests for this employee
    const approvedLoans = await this.prisma.loanRequest.findMany({
      where: {
        employeeId: detail.employeeId,
        status: { in: ['approved', 'disbursed', 'completed'] },
      },
    });

    // For simplicity, we'll take the sum of all loans if multiple exist
    const totalLoanAmount = approvedLoans.reduce(
      (sum, loan) => sum.add(new Decimal(loan.amount)),
      new Decimal(0),
    );

    // Total paid in previous months
    const loanPaidAmount = allPreviousDetails.reduce(
      (sum, d) => sum.add(new Decimal(d.loanDeduction)),
      new Decimal(0),
    );

    const loanDeductedThisMonth = new Decimal(detail.loanDeduction);

    const loanClosingBalance = totalLoanAmount
      .minus(loanPaidAmount)
      .minus(loanDeductedThisMonth);

    return {
      ...detail,
      pfBalances: {
        opening: pfOpeningBalance.toNumber(),
        added: pfAddedDuringMonth.toNumber(),
        withdrawal: pfWithdrawalAmount.toNumber(),
        closing: pfClosingBalance.toNumber(),
      },
      loanBalances: {
        totalAmount: totalLoanAmount.toNumber(),
        paidAmount: loanPaidAmount.toNumber(),
        deductedThisMonth: loanDeductedThisMonth.toNumber(),
        closingBalance: Math.max(0, loanClosingBalance.toNumber()),
      },
    };
  }

  // --- Helper Methods ---

  private calculateAllowances(allowances: any[]): Decimal {
    // Filter for paymentMethod 'with_salary' (same as bonuses)
    return allowances
      .filter((allow) => allow.paymentMethod === 'with_salary')
      .reduce(
        (sum, allow) => sum.add(new Decimal(allow.amount)),
        new Decimal(0),
      );
  }

  private calculateBonuses(bonuses: any[]): Decimal {
    // Filter for paymentMethod 'with_salary'
    return bonuses
      .filter((b) => b.paymentMethod === 'with_salary')
      .reduce((sum, b) => sum.add(new Decimal(b.amount)), new Decimal(0));
  }

  private calculateLeaveEncashment(leaveEncashments: any[]): Decimal {
    // Sum all approved and active leave encashments for the payment month
    return leaveEncashments
      .filter(
        (le) => le.approvalStatus === 'approved' && le.status === 'active',
      )
      .reduce(
        (sum, le) => sum.add(new Decimal(le.encashmentAmount)),
        new Decimal(0),
      );
  }

  private calculateAdHocDeductions(deductions: any[]): Decimal {
    return deductions.reduce(
      (sum, ded) => sum.add(new Decimal(ded.amount)),
      new Decimal(0),
    );
  }

  private async calculateEOBI_PF(
    employee: any,
    month: string,
    year: string,
    grossSalary: Decimal,
  ) {
    let eobiDeduction = new Decimal(0);
    let providentFundDeduction = new Decimal(0);

    // Calculate EOBI deduction from master table
    if (employee.eobi) {
      try {
        // Format yearMonth as "MMMM yyyy" (e.g., "January 2024") to match frontend format
        const monthNames = [
          'January',
          'February',
          'March',
          'April',
          'May',
          'June',
          'July',
          'August',
          'September',
          'October',
          'November',
          'December',
        ];
        const monthIndex = parseInt(month, 10) - 1;
        const monthName = monthNames[monthIndex];
        const yearMonth = `${monthName} ${year}`;

        // Also try "YYYY-MM" format as fallback
        const yearMonthAlt = `${year}-${month.padStart(2, '0')}`;

        // Fetch EOBI record for the payroll month/year
        const eobiRecord = await this.prisma.eOBI.findFirst({
          where: {
            OR: [{ yearMonth: yearMonth }, { yearMonth: yearMonthAlt }],
            status: 'active',
          },
          orderBy: { createdAt: 'desc' },
        });

        if (eobiRecord) {
          // Use employeeContribution for deduction (employer pays their part separately)
          eobiDeduction = new Decimal(eobiRecord.employeeContribution);
        } else {
          this.logger.warn(
            `No active EOBI record found for employee ${employee.id} (${employee.employeeId}) for ${yearMonth} or ${yearMonthAlt}. EOBI deduction will be 0.`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Error fetching EOBI for employee ${employee.id} (${employee.employeeId}): ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        // Continue with 0 deduction if error occurs
      }
    }

    // Provident Fund calculation from master table
    if (employee.providentFund) {
      try {
        // Fetch active ProvidentFund record from master table
        const pfRecord = await this.prisma.providentFund.findFirst({
          where: {
            status: 'active',
          },
          orderBy: { createdAt: 'desc' },
        });

        if (pfRecord) {
          // Calculate PF deduction as percentage of Gross Salary
          providentFundDeduction = grossSalary
            .mul(new Decimal(pfRecord.percentage))
            .div(100);
        } else {
          this.logger.warn(
            `No active ProvidentFund record found for employee ${employee.id} (${employee.employeeId}). PF deduction will be 0.`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Error fetching ProvidentFund for employee ${employee.id} (${employee.employeeId}): ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        // Continue with 0 deduction if error occurs
      }
    }

    return { eobiDeduction, providentFundDeduction };
  }

  private calculateLoansAndAdvances(
    employee: any,
    month: string,
    year: string,
  ) {
    let loanDeduction = new Decimal(0);
    let advanceSalaryDeduction = new Decimal(0);

    // Loans
    const emp = employee as any;
    if (emp.loanRequests && emp.loanRequests.length > 0) {
      for (const loan of emp.loanRequests) {
        if (!loan.repaymentStartMonthYear || !loan.numberOfInstallments) {
          continue;
        }

        const [startYear, startMonth] = loan.repaymentStartMonthYear
          .split('-')
          .map(Number);
        const currentY = Number(year);
        const currentM = Number(month);

        const diffMonths =
          (currentY - startYear) * 12 + (currentM - startMonth);

        if (diffMonths >= 0 && diffMonths < loan.numberOfInstallments) {
          const installment = new Decimal(loan.amount).div(
            loan.numberOfInstallments,
          );
          loanDeduction = loanDeduction.add(installment);
        }
      }
    }

    // Advances - Filter by deduction month/year
    if (emp.advanceSalaries && emp.advanceSalaries.length > 0) {
      const normalizedMonthForComparison = String(Number(month)).padStart(
        2,
        '0',
      );
      const normalizedYearForComparison = String(year);
      const deductionMonthYearStr = `${normalizedYearForComparison}-${normalizedMonthForComparison}`;

      for (const advance of emp.advanceSalaries) {
        const matchesMonth =
          advance.deductionMonth === normalizedMonthForComparison ||
          String(Number(advance.deductionMonth)).padStart(2, '0') ===
          normalizedMonthForComparison;
        const matchesYear =
          advance.deductionYear === normalizedYearForComparison ||
          String(advance.deductionYear) === normalizedYearForComparison;
        const matchesMonthYear =
          advance.deductionMonthYear === deductionMonthYearStr;

        if (matchesMonthYear || (matchesMonth && matchesYear)) {
          const amount = new Decimal(advance.amount);
          advanceSalaryDeduction = advanceSalaryDeduction.add(amount);
        }
      }
    }

    return { loanDeduction, advanceSalaryDeduction };
  }

  private calculateEffectiveSalary(
    employee: any,
    monthStartDate: Date,
    monthEndDate: Date,
    totalDaysInMonth: number,
  ): { effectivePackage: Decimal; incrementBreakup: any[] } {
    const baseSalary = new Decimal(employee.employeeSalary);
    const incrementBreakup: any[] = [];

    // Normalize dates to start of day for accurate comparison
    const normalizeDate = (date: Date): Date => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      return d;
    };

    const monthStart = normalizeDate(monthStartDate);
    const monthEnd = normalizeDate(monthEndDate);

    // If no increments, return base salary
    if (!employee.increments || employee.increments.length === 0) {
      return { effectivePackage: baseSalary, incrementBreakup: [] };
    }

    // Filter increments that are effective before or during this month
    // Get the most recent increment before the month starts to know the starting salary
    const incrementsBeforeMonth = employee.increments
      .filter((inc: any) => {
        const incDate = normalizeDate(new Date(inc.promotionDate));
        return incDate < monthStart;
      })
      .sort(
        (a: any, b: any) =>
          new Date(b.promotionDate).getTime() -
          new Date(a.promotionDate).getTime(),
      );

    // Starting salary: If there's an increment before the month, use that salary; otherwise use base salary
    let currentSalary =
      incrementsBeforeMonth.length > 0
        ? new Decimal(incrementsBeforeMonth[0].salary)
        : baseSalary;

    // Find increments that occur during this month
    const incrementsInMonth = employee.increments
      .filter((inc: any) => {
        const incDate = normalizeDate(new Date(inc.promotionDate));
        return incDate >= monthStart && incDate <= monthEnd;
      })
      .sort(
        (a: any, b: any) =>
          new Date(a.promotionDate).getTime() -
          new Date(b.promotionDate).getTime(),
      );

    let effectivePackage = new Decimal(0);

    if (incrementsInMonth.length === 0) {
      // No increment during this month, use current salary for entire month
      effectivePackage = currentSalary;
    } else {
      // Calculate proportional salary for each period
      let lastDate = monthStart;

      for (const increment of incrementsInMonth) {
        const incrementDate = normalizeDate(new Date(increment.promotionDate));
        // If increment is on or before month start, use new salary for entire month
        if (incrementDate <= monthStart) {
          // Record increment/decrement info
          incrementBreakup.push({
            id: increment.id,
            type: increment.incrementType,
            date: increment.promotionDate,
            oldSalary: currentSalary.toNumber(),
            newSalary: Number(increment.salary),
            amount: increment.incrementAmount
              ? Number(increment.incrementAmount)
              : null,
            percentage: increment.incrementPercentage
              ? Number(increment.incrementPercentage)
              : null,
            method: increment.incrementMethod,
            daysBefore: 0,
          });
          // Use new salary for entire month
          currentSalary = new Decimal(increment.salary);
          effectivePackage = currentSalary;
          lastDate = new Date(monthEnd);
          lastDate.setDate(lastDate.getDate() + 1);
          continue;
        }

        // Calculate days from lastDate (inclusive) to incrementDate (exclusive)
        const daysBeforeIncrement = Math.max(
          0,
          Math.floor(
            (incrementDate.getTime() - lastDate.getTime()) /
            (1000 * 60 * 60 * 24),
          ),
        );

        if (daysBeforeIncrement > 0) {
          // Add salary for days before this increment
          effectivePackage = effectivePackage.add(
            currentSalary.mul(daysBeforeIncrement).div(totalDaysInMonth),
          );
        }

        // Record increment/decrement info
        incrementBreakup.push({
          id: increment.id,
          type: increment.incrementType,
          date: increment.promotionDate,
          oldSalary: currentSalary.toNumber(),
          newSalary: Number(increment.salary),
          amount: increment.incrementAmount
            ? Number(increment.incrementAmount)
            : null,
          percentage: increment.incrementPercentage
            ? Number(increment.incrementPercentage)
            : null,
          method: increment.incrementMethod,
          daysBefore: daysBeforeIncrement,
        });

        // Update current salary to new salary
        currentSalary = new Decimal(increment.salary);
        // Start counting from the day after the increment date
        lastDate = new Date(incrementDate);
        lastDate.setDate(lastDate.getDate() + 1);
      }

      // Add salary for remaining days after last increment
      const daysAfterLastIncrement = Math.max(
        0,
        Math.floor(
          (monthEnd.getTime() - lastDate.getTime() + 1000 * 60 * 60 * 24) /
          (1000 * 60 * 60 * 24),
        ),
      );
      if (daysAfterLastIncrement > 0) {
        effectivePackage = effectivePackage.add(
          currentSalary.mul(daysAfterLastIncrement).div(totalDaysInMonth),
        );
      }
    }

    return { effectivePackage, incrementBreakup };
  }

  private async calculateAttendanceDeductions(
    employee: any,
    month: string,
    year: string,
    defaultPolicy: any,
    policyAssignments: any[],
    totalSalary: Decimal,
    allHolidays: any[],
  ): Promise<{ attendanceDeduction: Decimal; attendanceBreakup: any }> {
    const startDate = new Date(`${year}-${month}-01`);
    const endDate = new Date(Number(year), Number(month), 0);
    const totalDaysInMonth = endDate.getDate();

    const attendances = await this.prisma.attendance.findMany({
      where: {
        employeeId: employee.id,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    const attendanceMap = new Map<string, any>(
      attendances.map((att) => [new Date(att.date).toDateString(), att]),
    );

    let totalDeduction = new Decimal(0);

    // Calculate per day salary based on actual days in month - using total salary
    const perDaySalary = totalSalary.div(totalDaysInMonth);

    // Helper to check if date has approved leave
    const hasApprovedLeave = (date: Date): boolean => {
      if (
        !employee.leaveApplications ||
        employee.leaveApplications.length === 0
      )
        return false;

      const dateOnly = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
      );

      return employee.leaveApplications.some((leave: any) => {
        const fromDate = new Date(leave.fromDate);
        const toDate = new Date(leave.toDate);
        fromDate.setHours(0, 0, 0, 0);
        toDate.setHours(23, 59, 59, 999);

        return dateOnly >= fromDate && dateOnly <= toDate;
      });
    };

    // Helper to resolve policy for a specific date
    const getPolicyForDate = (date: Date) => {
      const dateCheck = new Date(date);
      dateCheck.setHours(0, 0, 0, 0);

      // Check assignments (sorted by start date usually, but find is fine)
      const assignment = policyAssignments?.find((pa) => {
        const start = new Date(pa.startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(pa.endDate);
        end.setHours(23, 59, 59, 999); // End of day
        return dateCheck >= start && dateCheck <= end;
      });

      return assignment?.workingHoursPolicy || defaultPolicy;
    };

    // Buckets to track counts per policy
    const policyBuckets = new Map<
      string,
      {
        policy: any;
        stats: {
          late: number;
          absent: number;
          halfDay: number;
          shortDay: number;
        };
      }
    >();

    const getBucket = (policy: any) => {
      if (!policy) return null;
      if (!policyBuckets.has(policy.id)) {
        policyBuckets.set(policy.id, {
          policy,
          stats: { late: 0, absent: 0, halfDay: 0, shortDay: 0 },
        });
      }
      return policyBuckets.get(policy.id)!;
    };

    let leaveDaysCount = 0;

    // Day names for policy override checks
    const dayNames = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];

    // Iterate through EVERY day of the month to ensure complete coverage
    for (let day = 1; day <= totalDaysInMonth; day++) {
      const checkDate = new Date(Number(year), Number(month) - 1, day);
      const dateStr = checkDate.toDateString();
      const att = attendanceMap.get(dateStr);
      const hasLeave = hasApprovedLeave(checkDate);
      const policy = getPolicyForDate(checkDate);
      const bucket = getBucket(policy);

      const dayName = dayNames[checkDate.getDay()];

      // Check if it's a weekend or day-off based on policy
      let isDayOff = dayName === 'saturday' || dayName === 'sunday';
      if (policy?.dayOverrides && typeof policy.dayOverrides === 'object') {
        const overrides = policy.dayOverrides as any;
        if (overrides[dayName]) {
          // If explicitly mentioned in overrides, use the enabled flag
          // If enabled is true, it's a working day. If false, it's a day off.
          isDayOff = !overrides[dayName].enabled;
        }
      }

      // Check if it's a holiday
      const isHoliday = allHolidays?.some((holiday) => {
        const holidayStart = new Date(holiday.dateFrom);
        const holidayEnd = new Date(holiday.dateTo);
        holidayStart.setHours(0, 0, 0, 0);
        holidayEnd.setHours(23, 59, 59, 999);
        return checkDate >= holidayStart && checkDate <= holidayEnd;
      });

      if (hasLeave) {
        leaveDaysCount++;
        continue; // Leaves don't count towards deductions
      }

      if (isHoliday || isDayOff) {
        continue; // Holidays and weekends don't count towards deductions unless there's specific logic for them
      }

      if (bucket) {
        if (!att || att.status === 'absent') {
          bucket.stats.absent++;
        } else if (
          att.status === 'late' ||
          (att.lateMinutes && att.lateMinutes > 0)
        ) {
          bucket.stats.late++;
        } else if (att.status === 'half-day') {
          bucket.stats.halfDay++;
        } else if (att.status === 'short-day') {
          bucket.stats.shortDay++;
        }
      }
    }

    // 3. Calculate Deductions per Bucket
    let totalAbsentCount = 0;
    let totalLateCount = 0;
    let totalHalfDayCount = 0;
    let totalShortDayCount = 0;

    let totalHalfDayDeductionAmount = new Decimal(0);
    let totalShortDayDeductionAmount = new Decimal(0);
    let totalLateDeductionAmount = new Decimal(0);

    for (const { policy, stats } of policyBuckets.values()) {
      totalAbsentCount += stats.absent;
      totalLateCount += stats.late;
      totalHalfDayCount += stats.halfDay;
      totalShortDayCount += stats.shortDay;

      // Absent Deduction
      totalDeduction = totalDeduction.add(perDaySalary.mul(stats.absent));

      // Half Day Deduction
      if (
        policy.halfDayDeductionType &&
        policy.halfDayDeductionAmount &&
        stats.halfDay > 0
      ) {
        let chargeableHalfDays = stats.halfDay;
        if (policy.applyDeductionAfterHalfDays) {
          chargeableHalfDays = Math.max(
            0,
            stats.halfDay - policy.applyDeductionAfterHalfDays,
          );
        }

        if (chargeableHalfDays > 0) {
          let amount = new Decimal(0);
          if (policy.halfDayDeductionType === 'amount') {
            amount = new Decimal(policy.halfDayDeductionAmount).mul(
              chargeableHalfDays,
            );
          } else if (policy.halfDayDeductionType === 'percentage') {
            amount = perDaySalary
              .mul(new Decimal(policy.halfDayDeductionAmount).div(100))
              .mul(chargeableHalfDays);
          }
          totalHalfDayDeductionAmount = totalHalfDayDeductionAmount.add(amount);
          totalDeduction = totalDeduction.add(amount);
        }
      }

      // Short Day Deduction
      if (
        policy.shortDayDeductionType &&
        policy.shortDayDeductionAmount &&
        stats.shortDay > 0
      ) {
        let chargeableShortDays = stats.shortDay;
        if (policy.applyDeductionAfterShortDays) {
          chargeableShortDays = Math.max(
            0,
            stats.shortDay - policy.applyDeductionAfterShortDays,
          );
        }

        if (chargeableShortDays > 0) {
          let amount = new Decimal(0);
          if (policy.shortDayDeductionType === 'amount') {
            amount = new Decimal(policy.shortDayDeductionAmount).mul(
              chargeableShortDays,
            );
          } else if (policy.shortDayDeductionType === 'percentage') {
            amount = perDaySalary
              .mul(new Decimal(policy.shortDayDeductionAmount).div(100))
              .mul(chargeableShortDays);
          }
          totalShortDayDeductionAmount =
            totalShortDayDeductionAmount.add(amount);
          totalDeduction = totalDeduction.add(amount);
        }
      }

      // Late Deduction
      if (
        policy.lateDeductionType &&
        policy.lateDeductionPercent &&
        stats.late > 0
      ) {
        let chargeableLates = stats.late;
        if (policy.applyDeductionAfterLates) {
          chargeableLates = Math.max(
            0,
            stats.late - policy.applyDeductionAfterLates,
          );
        }

        if (chargeableLates > 0) {
          const deductionPerLate = perDaySalary.mul(
            new Decimal(policy.lateDeductionPercent).div(100),
          );
          const amount = deductionPerLate.mul(chargeableLates);
          totalLateDeductionAmount = totalLateDeductionAmount.add(amount);
          totalDeduction = totalDeduction.add(amount);
        }
      }
    }

    // Create attendance breakdown (Aggregate logic for simplicity in UI, though calculation was segmented)
    const attendanceBreakup = {
      absent: {
        count: totalAbsentCount,
        amount: Math.round(perDaySalary.mul(totalAbsentCount).toNumber()),
      },
      late: {
        count: totalLateCount,
        chargeableCount: totalLateCount, // Simplified for UI
        amount: Math.round(totalLateDeductionAmount.toNumber()),
      },
      halfDay: {
        count: totalHalfDayCount,
        amount: Math.round(totalHalfDayDeductionAmount.toNumber()),
      },
      shortDay: {
        count: totalShortDayCount,
        amount: Math.round(totalShortDayDeductionAmount.toNumber()),
      },
      leave: {
        count: leaveDaysCount,
        amount: 0,
      },
    };

    return { attendanceDeduction: totalDeduction, attendanceBreakup };
  }

  private async calculateOvertime(
    employee: any,
    month: string,
    year: string,
    defaultPolicy: any,
    policyAssignments: any[],
    basicSalary: Decimal,
    monthStartDate: Date,
    monthEndDate: Date,
    allHolidays: any[],
  ): Promise<{ overtimeAmount: Decimal; overtimeBreakup: any[] }> {
    // Fetch approved OvertimeRequests for this month
    const startDate = new Date(`${year}-${month}-01`);
    const endDate = new Date(Number(year), Number(month), 0);

    const overtimes = await this.prisma.overtimeRequest.findMany({
      where: {
        employeeId: employee.id,
        status: 'approved',
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { date: 'asc' },
    });

    let amount = new Decimal(0);
    const overtimeBreakup: any[] = [];

    if (!employee.overtimeApplicable) {
      return { overtimeAmount: amount, overtimeBreakup };
    }

    // Helper to resolve policy for a specific date
    const getPolicyForDate = (date: Date) => {
      const dateCheck = new Date(date);
      dateCheck.setHours(0, 0, 0, 0);

      const assignment = policyAssignments?.find((pa) => {
        const start = new Date(pa.startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(pa.endDate);
        end.setHours(23, 59, 59, 999);
        return dateCheck >= start && dateCheck <= end;
      });

      return assignment?.workingHoursPolicy || defaultPolicy;
    };

    const totalDaysInMonth = monthEndDate.getDate();
    const hourlyRate = basicSalary.div(totalDaysInMonth).div(8); // Use calculated basic salary

    // Process overtime requests
    for (const ot of overtimes) {
      const policy = getPolicyForDate(ot.date);
      // If no policy found for date (and no default), skip?? Or assume 1?
      // Fallback to 1 if no rates defined
      let rateMultiplier = new Decimal(1);
      if (policy && policy.overtimeRate) {
        rateMultiplier = new Decimal(policy.overtimeRate);
      }

      let holidayMultiplier = rateMultiplier;
      if (policy && policy.gazzetedOvertimeRate) {
        holidayMultiplier = new Decimal(policy.gazzetedOvertimeRate);
      }

      const weekdayHours = new Decimal(ot.weekdayOvertimeHours || 0);
      const holidayHours = new Decimal(ot.holidayOvertimeHours || 0);

      const weekdayAmt = hourlyRate.mul(rateMultiplier).mul(weekdayHours);
      const holidayAmt = hourlyRate.mul(holidayMultiplier).mul(holidayHours);

      const otTotal = weekdayAmt.add(holidayAmt);
      amount = amount.add(otTotal);

      if (otTotal.gt(0)) {
        overtimeBreakup.push({
          id: ot.id,
          title: ot.title || 'Overtime',
          date: ot.date,
          weekdayHours: weekdayHours.toNumber(),
          holidayHours: holidayHours.toNumber(),
          amount: otTotal.toNumber(),
          type: ot.overtimeType,
          source: 'overtime_request',
        });
      }
    }

    // Fetch ALL attendance records for the month to check for overtime on holidays/weekends
    // We need all records with checkIn/checkOut to identify holidays/off days even if overtimeHours is not set
    const attendances = await this.prisma.attendance.findMany({
      where: {
        employeeId: employee.id,
        date: {
          gte: startDate,
          lte: endDate,
        },
        checkIn: { not: null },
        checkOut: { not: null },
      },
      orderBy: { date: 'asc' },
    });

    // Helper to check if a date is a holiday
    const isHoliday = (date: Date): boolean => {
      const month = date.getMonth() + 1;
      const day = date.getDate();
      return allHolidays.some((holiday) => {
        const holidayFrom = new Date(holiday.dateFrom);
        const holidayTo = new Date(holiday.dateTo);
        const holidayMonthFrom = holidayFrom.getMonth() + 1;
        const holidayDayFrom = holidayFrom.getDate();
        const holidayMonthTo = holidayTo.getMonth() + 1;
        const holidayDayTo = holidayTo.getDate();

        // Check if date falls within holiday range
        if (holidayMonthFrom === holidayMonthTo) {
          return (
            month === holidayMonthFrom &&
            day >= holidayDayFrom &&
            day <= holidayDayTo
          );
        } else {
          // Holiday spans across months
          return (
            (month === holidayMonthFrom && day >= holidayDayFrom) ||
            (month === holidayMonthTo && day <= holidayDayTo)
          );
        }
      });
    };

    // Helper to check if a date is a weekend
    const isWeekend = (date: Date): boolean => {
      const day = date.getDay();
      return day === 0 || day === 6; // Sunday or Saturday
    };

    // Helper to check if a date is a weekly off day based on policy
    const isWeeklyOff = (date: Date, policy: any): boolean => {
      const dayNames = [
        'sunday',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
      ];
      const dayName = dayNames[date.getDay()];

      // If policy has dayOverrides, check if this day is marked as off
      if (
        policy &&
        policy.dayOverrides &&
        typeof policy.dayOverrides === 'object'
      ) {
        const overrides = policy.dayOverrides as Record<string, any>;
        const dayConfig = overrides[dayName];
        if (dayConfig && dayConfig.dayType === 'off') {
          return true;
        }
        // If day is explicitly enabled/working, it's not an off day
        if (dayConfig && dayConfig.enabled && dayConfig.dayType !== 'off') {
          return false;
        }
      }

      // Default: Weekends (Saturday=6, Sunday=0) are off days if no policy override
      const dayOfWeek = date.getDay();
      return dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
    };

    // Process attendance records for overtime
    // Track dates already covered by overtime requests to avoid double counting
    const overtimeRequestDates = new Set(
      overtimes.map((ot) => new Date(ot.date).toDateString()),
    );

    for (const attendance of attendances) {
      const attDate = new Date(attendance.date);
      const attDateString = attDate.toDateString();
      const policy = getPolicyForDate(attDate);

      const isHolidayDate = isHoliday(attDate);
      const isWeekendDate = isWeekend(attDate);
      const isOffDay = isWeeklyOff(attDate, policy);
      const isOnHolidayOrOff = isHolidayDate || isOffDay;

      // Skip if already covered by overtime request (unless it's a holiday/off day - those always count)
      if (overtimeRequestDates.has(attDateString) && !isOnHolidayOrOff) {
        continue;
      }

      // Get rates from policy
      let rateMultiplier = new Decimal(1);
      if (policy && policy.overtimeRate) {
        rateMultiplier = new Decimal(policy.overtimeRate);
      }
      let holidayMultiplier = rateMultiplier;
      if (policy && policy.gazzetedOvertimeRate) {
        holidayMultiplier = new Decimal(policy.gazzetedOvertimeRate);
      }

      // Get overtimeHours from attendance record
      let otHours: Decimal | null = null;
      if (attendance.overtimeHours) {
        otHours =
          attendance.overtimeHours instanceof Decimal
            ? attendance.overtimeHours
            : new Decimal(attendance.overtimeHours);
      }

      // For holidays/off days: use overtimeHours if available, otherwise all working hours are overtime
      if (isOnHolidayOrOff && attendance.checkIn && attendance.checkOut) {
        if (!otHours || otHours.eq(0)) {
          // If no overtimeHours calculated, use workingHours (all hours worked are overtime on holidays/off days)
          otHours = attendance.workingHours
            ? attendance.workingHours instanceof Decimal
              ? attendance.workingHours
              : new Decimal(attendance.workingHours)
            : new Decimal(0);
        }

        if (otHours && otHours.gt(0)) {
          const overtimeAmt = hourlyRate.mul(holidayMultiplier).mul(otHours);
          amount = amount.add(overtimeAmt);
          overtimeBreakup.push({
            id: `attendance-${attendance.id}`,
            title: isHolidayDate ? 'Holiday Work' : 'Weekly Off Work',
            date: attendance.date,
            weekdayHours: 0,
            holidayHours: otHours.toNumber(),
            amount: overtimeAmt.toNumber(),
            type: isHolidayDate ? 'holiday' : 'weekly_off',
            source: 'attendance',
          });
        }
      } else if (otHours && otHours.gt(0)) {
        // Regular overtime (already calculated in attendance service)
        // Only add if not already covered by overtime request
        if (!overtimeRequestDates.has(attDateString)) {
          const overtimeAmt = hourlyRate.mul(rateMultiplier).mul(otHours);

          if (overtimeAmt.gt(0)) {
            amount = amount.add(overtimeAmt);
            overtimeBreakup.push({
              id: `attendance-${attendance.id}`,
              title: isWeekendDate ? 'Weekend Overtime' : 'Regular Overtime',
              date: attendance.date,
              weekdayHours: otHours.toNumber(),
              holidayHours: 0,
              amount: overtimeAmt.toNumber(),
              type: isWeekendDate ? 'weekend' : 'regular',
              source: 'attendance',
            });
          }
        }
      }
    }

    return { overtimeAmount: amount, overtimeBreakup };
  }

  private async calculateTax(
    salaryBreakup: Array<{
      id: string;
      name: string;
      percentage: number | null;
      amount: number;
      isTaxable?: boolean;
      isRecurring?: boolean;
    }>,
    rebates: any[],
    packageAmount: Decimal,
    allTaxSlabs: any[],
  ): Promise<{ taxDeduction: Decimal; taxBreakup: any }> {
    // Calculate taxable income from salary breakup components only (not gross salary)
    // Include ALL salary components (Basic Salary, House Rent, Utility, etc.) in taxable income
    // Sum up amounts from components marked as taxable (default is taxable unless explicitly marked as non-taxable)
    let annualTaxableIncome = new Decimal(0);
    const taxableComponents: Array<{
      name: string;
      amount: number;
      isRecurring: boolean;
      annualAmount: number;
    }> = [];

    for (const component of salaryBreakup) {
      // Include component if it's marked as taxable (default is true) and has amount > 0
      // This ensures Basic Salary, House Rent, Utility, and all other salary components are included
      if (component.isTaxable !== false && component.amount > 0) {
        // Determine if component is recurring (defaults to true if undefined, for backward compatibility)
        // BUT for our specific logic, we want explicit control.
        // Assuming salary components are recurring, but allowances/bonuses might not be.
        const isRecurring = component.isRecurring !== false;

        let annualAmount = new Decimal(0);

        if (isRecurring) {
          // Recurring components are annualized (x12)
          annualAmount = new Decimal(component.amount).mul(12);
        } else {
          // Specific/One-time components are added as-is (x1)
          annualAmount = new Decimal(component.amount);
        }

        annualTaxableIncome = annualTaxableIncome.add(annualAmount);

        taxableComponents.push({
          name: component.name,
          amount: component.amount,
          isRecurring: isRecurring,
          annualAmount: annualAmount.toNumber(),
        });
      }
    }

    // Convert to annual taxable income - ALREADY DONE IN LOOP
    // const annualTaxableIncome = monthlyTaxableAmount.mul(12); -> REMOVED

    let taxableIncome = annualTaxableIncome;
    let totalRebateAmount = new Decimal(0);
    const rebateBreakup: any[] = [];

    // Apply rebates (reduce taxable income by rebate amounts)
    if (rebates && rebates.length > 0) {
      for (const rebate of rebates) {
        const rebateAmount = new Decimal(rebate.rebateAmount);
        totalRebateAmount = totalRebateAmount.add(rebateAmount);
        taxableIncome = taxableIncome.minus(rebateAmount);
        rebateBreakup.push({
          id: rebate.id,
          name: rebate.rebateNature?.name || 'Rebate',
          amount: rebateAmount.toNumber(),
        });
      }
    }

    // Ensure taxable income is not negative
    if (taxableIncome.lt(0)) {
      taxableIncome = new Decimal(0);
    }

    let taxDeduction = new Decimal(0);
    let taxSlabUsed: {
      minAmount: number;
      maxAmount: number;
      rate: number;
    } | null = null;
    let fixedAmountTax = new Decimal(0);
    let percentageTaxAmount = new Decimal(0);

    // Apply tax slab to taxable income
    if (taxableIncome.gt(0)) {
      // Find the slab in memory from pre-fetched allTaxSlabs
      const slab = allTaxSlabs
        .filter((s) => s.status === 'active')
        .sort((a, b) => Number(b.minAmount) - Number(a.minAmount))
        .find(
          (s) =>
            new Decimal(taxableIncome).gte(new Decimal(s.minAmount)) &&
            (s.maxAmount === null ||
              new Decimal(taxableIncome).lte(new Decimal(s.maxAmount))),
        );

      if (slab) {
        taxSlabUsed = {
          minAmount: Number(slab.minAmount),
          maxAmount: Number(slab.maxAmount),
          rate: Number(slab.rate),
        };

        // Calculate tax: Fixed amount from previous slabs + percentage on excess
        const slabFixedAmount = (slab as any).fixedAmount;
        fixedAmountTax = slabFixedAmount
          ? new Decimal(slabFixedAmount)
          : new Decimal(0);
        const excess = taxableIncome.minus(new Decimal(slab.minAmount));
        // Calculate percentage tax on excess amount
        percentageTaxAmount = excess.mul(new Decimal(slab.rate).div(100));
        // Total annual tax = fixed amount + percentage tax
        const annualTax = fixedAmountTax.add(percentageTaxAmount);
        taxDeduction = annualTax.div(12);
      }
    }

    // Calculate annual gross from taxable components for display (backward compatibility)
    const annualGross = annualTaxableIncome;

    const taxBreakup = {
      annualGross: annualGross.toNumber(), // Annual taxable components amount (for display)
      annualTaxableComponents: annualTaxableIncome.toNumber(),
      taxableComponents: taxableComponents, // Breakdown of taxable components
      totalRebate: totalRebateAmount.toNumber(),
      taxableIncome: taxableIncome.toNumber(), // Taxable income after rebates
      taxSlab: taxSlabUsed,
      fixedAmountTax: fixedAmountTax.toNumber(), // Fixed amount tax from previous slabs
      percentageTax: percentageTaxAmount.toNumber(), // Percentage tax on excess amount
      monthlyTax: taxDeduction.toNumber(),
      rebateBreakup,
    };

    return { taxDeduction, taxBreakup };
  }
}
