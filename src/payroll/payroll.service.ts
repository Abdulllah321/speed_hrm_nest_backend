import { Injectable, BadRequestException, Logger, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { Decimal } from '@prisma/client/runtime/client';

@Injectable()
export class PayrollService {
    private readonly logger = new Logger(PayrollService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly activityLogsService: ActivityLogsService
    ) { }

    async previewPayroll(month: string, year: string, employeeIds?: string[]) {
        this.logger.log(`Previewing payroll for ${month}/${year}`);

        // Normalize month to "01"-"12" format for consistent querying
        const normalizedMonth = String(Number(month)).padStart(2, '0');
        const normalizedYear = String(year);

        // 1. Fetch active employees
        const whereClause: Prisma.EmployeeWhereInput = { status: 'active' };
        if (employeeIds && employeeIds.length > 0) {
            whereClause.id = { in: employeeIds };
        }

        const employees = await this.prisma.employee.findMany({
            where: whereClause,
            include: {
                workingHoursPolicy: true,
                leavesPolicy: true,
                socialSecurityInstitution: {
                    select: { id: true, name: true, contributionRate: true }
                },
                socialSecurityRegistrations: {
                    where: { status: 'active' },
                    include: {
                        institution: {
                            select: { id: true, name: true, contributionRate: true },
                        },
                    },
                    orderBy: { registrationDate: 'desc' },
                },
                allowances: {
                    where: { status: 'active', month: normalizedMonth, year: normalizedYear },
                    include: { allowanceHead: { select: { id: true, name: true } } }
                },
                deductions: {
                    where: { status: 'active', month: normalizedMonth, year: normalizedYear },
                    include: { deductionHead: { select: { id: true, name: true } } }
                },
                loanRequests: {
                    where: {
                        OR: [
                            { approvalStatus: 'approved' },
                            { status: 'approved' }
                        ]
                    }
                },
                advanceSalaries: {
                    where: {
                        approvalStatus: 'approved',
                        status: 'active'
                    }
                },
                leaveEncashments: {
                    where: {
                        approvalStatus: 'approved',
                        status: 'active',
                        paymentMonth: normalizedMonth,
                        paymentYear: normalizedYear
                    }
                },
                bonuses: {
                    where: { bonusMonth: normalizedMonth, bonusYear: normalizedYear, status: 'active' },
                    include: { bonusType: { select: { id: true, name: true } } }
                },
                rebates: { where: { monthYear: `${normalizedYear}-${normalizedMonth}`, status: 'approved' }, include: { rebateNature: true } },
                leaveApplications: {
                    where: {
                        status: 'approved',
                        OR: [
                            {
                                fromDate: { lte: new Date(Number(year), Number(month), 0) },
                                toDate: { gte: new Date(`${year}-${month}-01`) }
                            }
                        ]
                    },
                    select: {
                        id: true,
                        fromDate: true,
                        toDate: true,
                        status: true,
                    }
                },
                increments: {
                    where: {
                        status: 'active',
                        promotionDate: { lte: new Date(Number(year), Number(month), 0) }, // Increments effective on or before the end of payroll month
                    },
                    orderBy: { promotionDate: 'asc' },
                },
            },
        } as any);

        if (employees.length === 0) {
            throw new BadRequestException("No active employees found to generate payroll for.");
        }

        const salaryBreakups = await this.prisma.salaryBreakup.findMany({
            where: { status: 'active' }
        });

        const previewData: any[] = []; // Explicitly type as any[] or define an interface

        for (const employee of employees) {
            // Type cast to any to handle Prisma relations that may not be in generated types yet
            const emp = employee as any;
            const monthStartDate = new Date(`${normalizedYear}-${normalizedMonth}-01`);
            const monthEndDate = new Date(Number(normalizedYear), Number(normalizedMonth), 0);
            const totalDaysInMonth = monthEndDate.getDate();

            // Calculate effective salary considering increments/decrements during the month
            const { effectivePackage, incrementBreakup } = this.calculateEffectiveSalary(
                employee,
                monthStartDate,
                monthEndDate,
                totalDaysInMonth
            );

            // "effectivePackage" is the effective monthly package considering increments/decrements
            const packageAmount = effectivePackage;

            // Calculate breakup components using effective package
            // Parse details to get component-level taxability information
            const salaryBreakup = salaryBreakups.map(breakup => {
                let amount = new Decimal(0);
                let isTaxable = true;

                // Parse details JSON to check if this component is explicitly marked as non-taxable
                try {
                    if (breakup.details) {
                        const details = typeof breakup.details === 'string' ? JSON.parse(breakup.details) : breakup.details;
                        if (Array.isArray(details) && details.length > 0) {
                            // If details is an array, find the entry matching this breakup's name
                            const matchingEntry = details.find((entry: any) => entry.typeName === breakup.name);
                            if (matchingEntry && matchingEntry.isTaxable === false) {
                                isTaxable = false;
                            }
                        } else if (typeof details === 'object' && details.isTaxable === false) {
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
                    percentage: breakup.percentage ? new Decimal(breakup.percentage).toNumber() : null,
                    amount: Math.round(amount.toNumber()), // Round to whole number (no decimals)
                    isTaxable: isTaxable
                };
            });

            // Adjust the last component to ensure total equals packageAmount exactly (no rounding errors)
            if (salaryBreakup.length > 0) {
                const calculatedTotal = salaryBreakup.reduce((sum, component) => sum + component.amount, 0);
                const packageAmountRounded = Math.round(packageAmount.toNumber());
                const difference = packageAmountRounded - calculatedTotal;

                if (difference !== 0 && salaryBreakup.length > 0) {
                    // Add the difference to the last component to ensure exact total
                    salaryBreakup[salaryBreakup.length - 1].amount += difference;
                }
            }

            // Find "Basic Salary" component for rate calculations
            const basicComponent = salaryBreakup.find(b => b.name === 'Basic Salary');
            const calculatedBasicSalary = basicComponent ? new Decimal(basicComponent.amount) : packageAmount; // Fallback to package if no basic defined

            // Calculate total package amount (sum of all salary breakup components)
            const salaryBreakupTotal = salaryBreakup.reduce((sum, component) => sum + (component.amount || 0), 0);
            const totalPackageAmount = salaryBreakupTotal > 0 ? new Decimal(salaryBreakupTotal) : packageAmount;

            // A. Calculate Allowances (Ad-hoc additional allowances)
            const totalAdHocAllowances = this.calculateAllowances(emp.allowances || []);

            // Prepare allowance breakdown (only allowances with paymentMethod 'with_salary')
            const allowanceBreakup = (emp.allowances || [])
                .filter((allow: any) => allow.paymentMethod === 'with_salary')
                .map((allow: any) => ({
                    id: allow.id,
                    name: allow.allowanceHead?.name || 'Unknown',
                    amount: Number(allow.amount),
                    isTaxable: allow.isTaxable,
                    taxPercentage: allow.taxPercentage ? Number(allow.taxPercentage) : null,
                }));

            // B. Calculate Overtime (Using calculated Basic Salary for rate)
            // Include overtime from both overtimeRequests and attendance records (holidays/weekends)
            const { overtimeAmount, overtimeBreakup } = await this.calculateOvertime(employee, month, year, emp.workingHoursPolicy, calculatedBasicSalary, monthStartDate, monthEndDate);

            // C. Calculate Attendance Deductions (Lates/Absents) (using total package amount, not just basic salary)
            const { attendanceDeduction, attendanceBreakup } = await this.calculateAttendanceDeductions(employee, month, year, emp.workingHoursPolicy, totalPackageAmount);

            // D. Calculate Bonuses
            const bonusAmount = this.calculateBonuses(emp.bonuses || []);

            // Prepare bonus breakdown (only bonuses with paymentMethod 'with_salary')
            const bonusBreakup = (emp.bonuses || [])
                .filter(b => b.paymentMethod === 'with_salary')
                .map((bonus) => ({
                    id: bonus.id,
                    name: bonus.bonusType?.name || 'Unknown',
                    amount: Number(bonus.amount),
                    calculationType: bonus.calculationType,
                    percentage: bonus.percentage ? Number(bonus.percentage) : null,
                }));

            // D1. Calculate Leave Encashment
            const leaveEncashmentAmount = this.calculateLeaveEncashment(emp.leaveEncashments || []);

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
            const grossSalary = totalPackageAmount.add(totalAdHocAllowances).add(overtimeAmount).add(bonusAmount).add(leaveEncashmentAmount);

            // E1. Calculate Social Security Contribution Amount
            // Prefer explicit employee social security institution; fallback to latest registration's institution
            let socialSecurityContributionAmount = new Decimal(0);
            let socialSecurityRate: Decimal | null = null;
            if (emp.socialSecurityInstitution && emp.socialSecurityInstitution.contributionRate) {
                socialSecurityRate = new Decimal(emp.socialSecurityInstitution.contributionRate);
            } else if (emp.socialSecurityRegistrations && emp.socialSecurityRegistrations.length > 0) {
                const latestReg = emp.socialSecurityRegistrations[0];
                if (latestReg.institution && latestReg.institution.contributionRate) {
                    socialSecurityRate = new Decimal(latestReg.institution.contributionRate);
                }
            }
            if (socialSecurityRate && socialSecurityRate.gt(0)) {
                socialSecurityContributionAmount = grossSalary.mul(socialSecurityRate).div(100);
            }

            // F. Calculate Tax (with Rebates)
            // Tax is calculated based on taxable salary breakup components, not gross salary
            const { taxDeduction, taxBreakup } = await this.calculateTax(salaryBreakup, emp.rebates || [], packageAmount);

            // G. Calculate EOBI & PF
            const { eobiDeduction, providentFundDeduction } = await this.calculateEOBI_PF(employee, month, year, grossSalary);

            // H. Calculate Loans & Advances
            const { loanDeduction, advanceSalaryDeduction } = this.calculateLoansAndAdvances(employee, normalizedMonth, normalizedYear);

            // I. Other Ad-hoc Deductions
            const totalAdHocDeductions = this.calculateAdHocDeductions(emp.deductions || []);

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
                basicSalary: calculatedBasicSalary.toNumber(),
                salaryBreakup,
                allowanceBreakup,
                totalAllowances: totalAdHocAllowances.toNumber(),
                overtimeBreakup,
                overtimeAmount: overtimeAmount.toNumber(),
                bonusBreakup,
                bonusAmount: bonusAmount.toNumber(),
                leaveEncashmentAmount: leaveEncashmentAmount.toNumber(),
                socialSecurityContributionAmount: socialSecurityContributionAmount.toNumber(),
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
            const employeeIds = details.map(d => d.employeeId);
            const employeesInfo = await this.prisma.employee.findMany({
                where: { id: { in: employeeIds } },
                select: {
                    id: true,
                    accountNumber: true,
                    bankName: true,
                }
            });

            const employeeMap = new Map(employeesInfo.map(e => [e.id, e]));

            // Check if payroll already exists
            let payroll = await this.prisma.payroll.findFirst({
                where: {
                    month,
                    year,
                },
            });

            if (payroll) {
                if (payroll.status !== 'draft' && payroll.status !== 'confirmed') {
                    throw new BadRequestException('Payroll for this month is already processed/approved.');
                }
            } else {
                // Create new payroll header if not exists
                payroll = await this.prisma.payroll.create({
                    data: {
                        month,
                        year,
                        totalAmount: 0,
                        status: 'confirmed',
                        generatedBy: generatedBy ? { connect: { id: generatedBy } } : undefined,
                    }
                });
            }

            // Remove existing details for submitted employees
            await this.prisma.payrollDetail.deleteMany({
                where: {
                    payrollId: payroll.id,
                    employeeId: { in: employeeIds }
                }
            });

            const payrollDetailsData: any[] = details.map(d => {
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
                    socialSecurityContributionAmount: new Decimal(d.socialSecurityContributionAmount || 0),
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
                _sum: { netSalary: true }
            });

            await this.prisma.payroll.update({
                where: { id: payroll.id },
                data: {
                    totalAmount: aggregate._sum.netSalary || new Decimal(0),
                    status: 'confirmed'
                }
            });

            // Log Component
            await this.activityLogsService.log({
                module: "payroll",
                action: "generate",
                entity: "Payroll",
                entityId: payroll.id,
                description: `Confirmed payroll for ${month}/${year}`,
                status: "success",
                userId: generatedBy,
            });

            return payroll;
        } catch (error) {
            this.logger.error(`Error confirming payroll: ${error.message}`, error.stack);

            // Log failure to activity logs
            await this.activityLogsService.log({
                module: "payroll",
                action: "generate",
                entity: "Payroll",
                description: `Failed to confirm payroll for ${month}/${year}: ${error.message}`,
                status: "failure",
                userId: generatedBy,
                errorMessage: error.message
            });

            throw error instanceof BadRequestException ? error : new InternalServerErrorException(error.message);
        }
    }

    async getPayrollById(id: string) {
        return this.prisma.payroll.findUnique({
            where: { id },
            include: { details: { include: { employee: true } } }
        })
    }

    async getPayrollReport(filters: { month?: string; year?: string; departmentId?: string; subDepartmentId?: string; employeeId?: string }) {
        const where: Prisma.PayrollDetailWhereInput = {};

        if (filters.month || filters.year) {
            where.payroll = {
                ...(filters.month && filters.month !== 'all' && { month: filters.month }),
                ...(filters.year && filters.year !== 'all' && { year: filters.year }),
            };
        }

        if (filters.employeeId && filters.employeeId !== 'all') {
            where.employeeId = filters.employeeId;
        }

        if ((filters.departmentId && filters.departmentId !== 'all') || (filters.subDepartmentId && filters.subDepartmentId !== 'all')) {
            where.employee = {
                ...(filters.departmentId && filters.departmentId !== 'all' && { departmentId: filters.departmentId }),
                ...(filters.subDepartmentId && filters.subDepartmentId !== 'all' && { subDepartmentId: filters.subDepartmentId }),
            };
        }

        return this.prisma.payrollDetail.findMany({
            where,
            include: {
                employee: {
                    include: {
                        department: true,
                        subDepartment: true,
                        designation: true,
                        country: true,
                        state: true,
                        city: true,
                        location: true,
                    }
                },
                payroll: true,
            },
            orderBy: {
                employee: {
                    employeeName: 'asc'
                }
            }
        });
    }

    async getBankReport(filters: { month: string; year: string; bankName: string }) {
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
                    }
                },
            },
            orderBy: {
                employee: {
                    employeeName: 'asc'
                }
            }
        });
    }

    async getPayslips(filters: { month?: string; year?: string; departmentId?: string; subDepartmentId?: string; employeeId?: string }) {
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
            payroll: payrollWhere
        };

        if (filters.employeeId && filters.employeeId !== 'all') {
            where.employeeId = filters.employeeId;
        }

        if ((filters.departmentId && filters.departmentId !== 'all') || (filters.subDepartmentId && filters.subDepartmentId !== 'all')) {
            where.employee = {
                ...(filters.departmentId && filters.departmentId !== 'all' && { departmentId: filters.departmentId }),
                ...(filters.subDepartmentId && filters.subDepartmentId !== 'all' && { subDepartmentId: filters.subDepartmentId }),
            };
        }

        return this.prisma.payrollDetail.findMany({
            where,
            include: {
                employee: {
                    select: {
                        employeeId: true,
                        employeeName: true,
                        officialEmail: true,
                        department: { select: { name: true } },
                        subDepartment: { select: { name: true } },
                    }
                },
                payroll: true,
            },
            orderBy: {
                employee: {
                    employeeName: 'asc'
                }
            }
        });
    }

    async getPayslipDetail(detailId: string) {
        const detail = await this.prisma.payrollDetail.findUnique({
            where: { id: detailId },
            include: {
                employee: {
                    include: {
                        department: true,
                        subDepartment: true,
                        designation: true,
                        employeeGrade: true,
                    }
                },
                payroll: true,
            }
        });

        if (!detail) {
            throw new BadRequestException("Payslip not found");
        }

        // 1. Calculate PF Balances
        const allPreviousDetails = await this.prisma.payrollDetail.findMany({
            where: {
                employeeId: detail.employeeId,
                payroll: {
                    status: 'confirmed',
                    OR: [
                        { year: { lt: detail.payroll.year } },
                        { year: detail.payroll.year, month: { lt: detail.payroll.month } }
                    ]
                }
            }
        });

        // Sum up both employee and employer contributions (assuming matching)
        const pfOpeningBalance = allPreviousDetails.reduce((sum, d) =>
            sum.add(new Decimal(d.providentFundDeduction).mul(2)), new Decimal(0));

        const pfAddedDuringMonth = new Decimal(detail.providentFundDeduction).mul(2);

        // Withdrawal: Placeholder as there's no model for it yet
        const pfWithdrawalAmount = new Decimal(0);

        const pfClosingBalance = pfOpeningBalance.add(pfAddedDuringMonth).minus(pfWithdrawalAmount);

        // 2. Calculate Loan Balances
        // Fetch all approved loan requests for this employee
        const approvedLoans = await this.prisma.loanRequest.findMany({
            where: {
                employeeId: detail.employeeId,
                status: { in: ['approved', 'disbursed', 'completed'] }
            }
        });

        // For simplicity, we'll take the sum of all loans if multiple exist
        const totalLoanAmount = approvedLoans.reduce((sum, loan) => sum.add(new Decimal(loan.amount)), new Decimal(0));

        // Total paid in previous months
        const loanPaidAmount = allPreviousDetails.reduce((sum, d) => sum.add(new Decimal(d.loanDeduction)), new Decimal(0));

        const loanDeductedThisMonth = new Decimal(detail.loanDeduction);

        const loanClosingBalance = totalLoanAmount.minus(loanPaidAmount).minus(loanDeductedThisMonth);

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
            }
        };
    }




    // --- Helper Methods ---

    private calculateAllowances(allowances: any[]): Decimal {
        // Filter for paymentMethod 'with_salary' (same as bonuses)
        return allowances
            .filter(allow => allow.paymentMethod === 'with_salary')
            .reduce((sum, allow) => sum.add(new Decimal(allow.amount)), new Decimal(0));
    }

    private calculateBonuses(bonuses: any[]): Decimal {
        // Filter for paymentMethod 'with_salary'
        return bonuses
            .filter(b => b.paymentMethod === 'with_salary')
            .reduce((sum, b) => sum.add(new Decimal(b.amount)), new Decimal(0));
    }

    private calculateLeaveEncashment(leaveEncashments: any[]): Decimal {
        // Sum all approved and active leave encashments for the payment month
        return leaveEncashments
            .filter(le => le.approvalStatus === 'approved' && le.status === 'active')
            .reduce((sum, le) => sum.add(new Decimal(le.encashmentAmount)), new Decimal(0));
    }

    private calculateAdHocDeductions(deductions: any[]): Decimal {
        return deductions.reduce((sum, ded) => sum.add(new Decimal(ded.amount)), new Decimal(0));
    }

    private async calculateEOBI_PF(employee: any, month: string, year: string, grossSalary: Decimal) {
        let eobiDeduction = new Decimal(0);
        let providentFundDeduction = new Decimal(0);

        // Calculate EOBI deduction from master table
        if (employee.eobi) {
            try {
                // Format yearMonth as "MMMM yyyy" (e.g., "January 2024") to match frontend format
                const monthNames = [
                    'January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'
                ];
                const monthIndex = parseInt(month, 10) - 1;
                const monthName = monthNames[monthIndex];
                const yearMonth = `${monthName} ${year}`;

                // Also try "YYYY-MM" format as fallback
                const yearMonthAlt = `${year}-${month.padStart(2, '0')}`;

                // Fetch EOBI record for the payroll month/year
                const eobiRecord = await this.prisma.eOBI.findFirst({
                    where: {
                        OR: [
                            { yearMonth: yearMonth },
                            { yearMonth: yearMonthAlt }
                        ],
                        status: 'active'
                    },
                    orderBy: { createdAt: 'desc' }
                });

                if (eobiRecord) {
                    // Use employeeContribution for deduction (employer pays their part separately)
                    eobiDeduction = new Decimal(eobiRecord.employeeContribution);
                } else {
                    this.logger.warn(
                        `No active EOBI record found for employee ${employee.id} (${employee.employeeId}) for ${yearMonth} or ${yearMonthAlt}. EOBI deduction will be 0.`
                    );
                }
            } catch (error) {
                this.logger.error(
                    `Error fetching EOBI for employee ${employee.id} (${employee.employeeId}): ${error instanceof Error ? error.message : 'Unknown error'}`
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
                        status: 'active'
                    },
                    orderBy: { createdAt: 'desc' }
                });

                if (pfRecord) {
                    // Calculate PF deduction as percentage of Gross Salary
                    providentFundDeduction = grossSalary.mul(new Decimal(pfRecord.percentage)).div(100);
                } else {
                    this.logger.warn(
                        `No active ProvidentFund record found for employee ${employee.id} (${employee.employeeId}). PF deduction will be 0.`
                    );
                }
            } catch (error) {
                this.logger.error(
                    `Error fetching ProvidentFund for employee ${employee.id} (${employee.employeeId}): ${error instanceof Error ? error.message : 'Unknown error'}`
                );
                // Continue with 0 deduction if error occurs
            }
        }

        return { eobiDeduction, providentFundDeduction };
    }

    private calculateLoansAndAdvances(employee: any, month: string, year: string) {
        let loanDeduction = new Decimal(0);
        let advanceSalaryDeduction = new Decimal(0);

        // Loans
        const emp = employee as any;
        if (emp.loanRequests && emp.loanRequests.length > 0) {
            for (const loan of emp.loanRequests) {
                if (!loan.repaymentStartMonthYear || !loan.numberOfInstallments) {
                    continue;
                }

                const [startYear, startMonth] = loan.repaymentStartMonthYear.split('-').map(Number);
                const currentY = Number(year);
                const currentM = Number(month);

                const diffMonths = (currentY - startYear) * 12 + (currentM - startMonth);

                if (diffMonths >= 0 && diffMonths < loan.numberOfInstallments) {
                    const installment = new Decimal(loan.amount).div(loan.numberOfInstallments);
                    loanDeduction = loanDeduction.add(installment);
                }
            }
        }

        // Advances - Filter by deduction month/year
        if (emp.advanceSalaries && emp.advanceSalaries.length > 0) {
            const normalizedMonthForComparison = String(Number(month)).padStart(2, '0');
            const normalizedYearForComparison = String(year);
            const deductionMonthYearStr = `${normalizedYearForComparison}-${normalizedMonthForComparison}`;

            for (const advance of emp.advanceSalaries) {
                const matchesMonth = advance.deductionMonth === normalizedMonthForComparison ||
                    String(Number(advance.deductionMonth)).padStart(2, '0') === normalizedMonthForComparison;
                const matchesYear = advance.deductionYear === normalizedYearForComparison ||
                    String(advance.deductionYear) === normalizedYearForComparison;
                const matchesMonthYear = advance.deductionMonthYear === deductionMonthYearStr;

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
        totalDaysInMonth: number
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
        const incrementsBeforeMonth = employee.increments.filter((inc: any) => {
            const incDate = normalizeDate(new Date(inc.promotionDate));
            return incDate < monthStart;
        }).sort((a: any, b: any) =>
            new Date(b.promotionDate).getTime() - new Date(a.promotionDate).getTime()
        );

        // Starting salary: If there's an increment before the month, use that salary; otherwise use base salary
        let currentSalary = incrementsBeforeMonth.length > 0
            ? new Decimal(incrementsBeforeMonth[0].salary)
            : baseSalary;

        // Find increments that occur during this month
        const incrementsInMonth = employee.increments.filter((inc: any) => {
            const incDate = normalizeDate(new Date(inc.promotionDate));
            return incDate >= monthStart && incDate <= monthEnd;
        }).sort((a: any, b: any) =>
            new Date(a.promotionDate).getTime() - new Date(b.promotionDate).getTime()
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
                        amount: increment.incrementAmount ? Number(increment.incrementAmount) : null,
                        percentage: increment.incrementPercentage ? Number(increment.incrementPercentage) : null,
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
                const daysBeforeIncrement = Math.max(0, Math.floor((incrementDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)));

                if (daysBeforeIncrement > 0) {
                    // Add salary for days before this increment
                    effectivePackage = effectivePackage.add(
                        currentSalary.mul(daysBeforeIncrement).div(totalDaysInMonth)
                    );
                }

                // Record increment/decrement info
                incrementBreakup.push({
                    id: increment.id,
                    type: increment.incrementType,
                    date: increment.promotionDate,
                    oldSalary: currentSalary.toNumber(),
                    newSalary: Number(increment.salary),
                    amount: increment.incrementAmount ? Number(increment.incrementAmount) : null,
                    percentage: increment.incrementPercentage ? Number(increment.incrementPercentage) : null,
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
            const daysAfterLastIncrement = Math.max(0, Math.floor((monthEnd.getTime() - lastDate.getTime() + (1000 * 60 * 60 * 24)) / (1000 * 60 * 60 * 24)));
            if (daysAfterLastIncrement > 0) {
                effectivePackage = effectivePackage.add(
                    currentSalary.mul(daysAfterLastIncrement).div(totalDaysInMonth)
                );
            }
        }

        return { effectivePackage, incrementBreakup };
    }

    private async calculateAttendanceDeductions(employee: any, month: string, year: string, policy: any, totalSalary: Decimal): Promise<{ attendanceDeduction: Decimal; attendanceBreakup: any }> {
        const startDate = new Date(`${year}-${month}-01`);
        const endDate = new Date(Number(year), Number(month), 0);

        const attendances = await this.prisma.attendance.findMany({
            where: {
                employeeId: employee.id,
                date: {
                    gte: startDate,
                    lte: endDate,
                }
            }
        });

        let deduction = new Decimal(0);
        let lateCount = 0;
        let absentCount = 0;
        let halfDayCount = 0;
        let shortDayCount = 0;

        // Calculate per day salary (assuming 30 days) - using total salary (package amount), not just basic salary
        const perDaySalary = totalSalary.div(30);

        // Helper function to check if date has approved leave
        const hasApprovedLeave = (date: Date): boolean => {
            if (!employee.leaveApplications || employee.leaveApplications.length === 0) return false;

            const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

            return employee.leaveApplications.some((leave: any) => {
                const fromDate = new Date(leave.fromDate);
                const toDate = new Date(leave.toDate);
                fromDate.setHours(0, 0, 0, 0);
                toDate.setHours(23, 59, 59, 999);

                return dateOnly >= fromDate && dateOnly <= toDate;
            });
        };

        // Count leave days
        let leaveDaysCount = 0;
        const totalDaysInMonth = new Date(Number(year), Number(month), 0).getDate();
        // Process attendances
        for (const att of attendances) {
            const attDate = new Date(att.date);
            const hasLeave = hasApprovedLeave(attDate);

            if (hasLeave) {
                leaveDaysCount++;
            }

            if (att.status === 'absent' && !hasLeave) {
                absentCount++;
            } else if (att.status === 'late' || (att.lateMinutes && att.lateMinutes > 0)) {
                lateCount++;
            } else if (att.status === 'half-day' && !hasLeave) {
                halfDayCount++;
            } else if (att.status === 'short-day' && !hasLeave) {
                shortDayCount++;
            }
        }

        // Calculate total working days in month for absent deduction
        // If no attendance records exist at all for the month, consider all days as absent (if no leave)
        if (attendances.length === 0) {
            // Check how many days have approved leave
            for (let day = 1; day <= totalDaysInMonth; day++) {
                const checkDate = new Date(Number(year), Number(month) - 1, day);
                if (hasApprovedLeave(checkDate)) {
                    leaveDaysCount++;
                }
            }
            absentCount = totalDaysInMonth - leaveDaysCount;
        }

        // Calculate individual deduction amounts
        const absentDeductionAmount = perDaySalary.mul(absentCount);
        let halfDayDeductionAmount = new Decimal(0);
        let shortDayDeductionAmount = new Decimal(0);
        let lateDeductionAmount = new Decimal(0);

        // Absent Deduction - Full day salary per absent day
        deduction = deduction.add(absentDeductionAmount);

        // Half Day Deduction
        if (policy && policy.halfDayDeductionType && policy.halfDayDeductionAmount && halfDayCount > 0) {
            if (policy.applyDeductionAfterHalfDays && halfDayCount >= policy.applyDeductionAfterHalfDays) {
                const chargeableHalfDays = Math.max(0, halfDayCount - (policy.applyDeductionAfterHalfDays || 0));
                if (chargeableHalfDays > 0) {
                    if (policy.halfDayDeductionType === 'amount') {
                        halfDayDeductionAmount = new Decimal(policy.halfDayDeductionAmount).mul(chargeableHalfDays);
                        deduction = deduction.add(halfDayDeductionAmount);
                    } else if (policy.halfDayDeductionType === 'percentage') {
                        halfDayDeductionAmount = perDaySalary.mul(new Decimal(policy.halfDayDeductionAmount || 0).div(100)).mul(chargeableHalfDays);
                        deduction = deduction.add(halfDayDeductionAmount);
                    }
                }
            } else if (!policy.applyDeductionAfterHalfDays) {
                // If no threshold, deduct for all half days
                if (policy.halfDayDeductionType === 'amount') {
                    halfDayDeductionAmount = new Decimal(policy.halfDayDeductionAmount).mul(halfDayCount);
                    deduction = deduction.add(halfDayDeductionAmount);
                } else if (policy.halfDayDeductionType === 'percentage') {
                    halfDayDeductionAmount = perDaySalary.mul(new Decimal(policy.halfDayDeductionAmount || 0).div(100)).mul(halfDayCount);
                    deduction = deduction.add(halfDayDeductionAmount);
                }
            }
        }

        // Short Day Deduction
        if (policy && policy.shortDayDeductionType && policy.shortDayDeductionAmount && shortDayCount > 0) {
            if (policy.applyDeductionAfterShortDays && shortDayCount >= policy.applyDeductionAfterShortDays) {
                const chargeableShortDays = Math.max(0, shortDayCount - (policy.applyDeductionAfterShortDays || 0));
                if (chargeableShortDays > 0) {
                    if (policy.shortDayDeductionType === 'amount') {
                        shortDayDeductionAmount = new Decimal(policy.shortDayDeductionAmount).mul(chargeableShortDays);
                        deduction = deduction.add(shortDayDeductionAmount);
                    } else if (policy.shortDayDeductionType === 'percentage') {
                        shortDayDeductionAmount = perDaySalary.mul(new Decimal(policy.shortDayDeductionAmount || 0).div(100)).mul(chargeableShortDays);
                        deduction = deduction.add(shortDayDeductionAmount);
                    }
                }
            } else if (!policy.applyDeductionAfterShortDays) {
                // If no threshold, deduct for all short days
                if (policy.shortDayDeductionType === 'amount') {
                    shortDayDeductionAmount = new Decimal(policy.shortDayDeductionAmount).mul(shortDayCount);
                    deduction = deduction.add(shortDayDeductionAmount);
                } else if (policy.shortDayDeductionType === 'percentage') {
                    shortDayDeductionAmount = perDaySalary.mul(new Decimal(policy.shortDayDeductionAmount || 0).div(100)).mul(shortDayCount);
                    deduction = deduction.add(shortDayDeductionAmount);
                }
            }
        }

        // Late Deduction Logic
        const chargeableLates = policy && policy.applyDeductionAfterLates
            ? Math.max(0, lateCount - policy.applyDeductionAfterLates)
            : lateCount;
        if (policy && policy.lateDeductionType && chargeableLates > 0 && policy.lateDeductionPercent) {
            const deductionPerLate = perDaySalary.mul(new Decimal(policy.lateDeductionPercent).div(100));
            lateDeductionAmount = deductionPerLate.mul(chargeableLates);
            deduction = deduction.add(lateDeductionAmount);
        }

        // Create attendance breakdown
        const attendanceBreakup = {
            absent: {
                count: absentCount,
                amount: absentDeductionAmount.toNumber(),
            },
            late: {
                count: lateCount,
                chargeableCount: chargeableLates,
                amount: lateDeductionAmount.toNumber(),
            },
            halfDay: {
                count: halfDayCount,
                amount: halfDayDeductionAmount.toNumber(),
            },
            shortDay: {
                count: shortDayCount,
                amount: shortDayDeductionAmount.toNumber(),
            },
            leave: {
                count: leaveDaysCount,
                amount: 0, // Leave doesn't cause deduction, just informational
            },
        };

        return { attendanceDeduction: deduction, attendanceBreakup };
    }

    private async calculateOvertime(employee: any, month: string, year: string, policy: any, basicSalary: Decimal, monthStartDate: Date, monthEndDate: Date): Promise<{ overtimeAmount: Decimal; overtimeBreakup: any[] }> {
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
                }
            },
            orderBy: { date: 'asc' }
        });

        let amount = new Decimal(0);
        const overtimeBreakup: any[] = [];

        if (!employee.overtimeApplicable || !policy) {
            return { overtimeAmount: amount, overtimeBreakup };
        }

        const hourlyRate = basicSalary.div(30).div(8); // Use calculated basic salary
        let rateMultiplier = new Decimal(1);
        if (policy.overtimeRate) {
            rateMultiplier = new Decimal(policy.overtimeRate);
        }

        let holidayMultiplier = rateMultiplier;
        if (policy.gazzetedOvertimeRate) {
            holidayMultiplier = new Decimal(policy.gazzetedOvertimeRate);
        }

        // Process overtime requests
        for (const ot of overtimes) {
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

        // Fetch all active holidays for date checking
        const allHolidays = await this.prisma.holiday.findMany({
            where: { status: 'active' },
        });

        // Helper to check if a date is a holiday
        const isHoliday = (date: Date): boolean => {
            const month = date.getMonth() + 1;
            const day = date.getDate();
            return allHolidays.some(holiday => {
                const holidayFrom = new Date(holiday.dateFrom);
                const holidayTo = new Date(holiday.dateTo);
                const holidayMonthFrom = holidayFrom.getMonth() + 1;
                const holidayDayFrom = holidayFrom.getDate();
                const holidayMonthTo = holidayTo.getMonth() + 1;
                const holidayDayTo = holidayTo.getDate();

                // Check if date falls within holiday range
                if (holidayMonthFrom === holidayMonthTo) {
                    return month === holidayMonthFrom && day >= holidayDayFrom && day <= holidayDayTo;
                } else {
                    // Holiday spans across months
                    return (month === holidayMonthFrom && day >= holidayDayFrom) ||
                        (month === holidayMonthTo && day <= holidayDayTo);
                }
            });
        };

        // Helper to check if a date is a weekend
        const isWeekend = (date: Date): boolean => {
            const day = date.getDay();
            return day === 0 || day === 6; // Sunday or Saturday
        };

        // Helper to check if a date is a weekly off day based on policy
        // Weekends (Saturday/Sunday) are typically off days, but check policy overrides
        const isWeeklyOff = (date: Date): boolean => {
            const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const dayName = dayNames[date.getDay()];

            // If policy has dayOverrides, check if this day is marked as off
            if (policy && policy.dayOverrides && typeof policy.dayOverrides === 'object') {
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
            overtimes.map(ot => new Date(ot.date).toDateString())
        );

        for (const attendance of attendances) {
            const attDate = new Date(attendance.date);
            const attDateString = attDate.toDateString();
            const isHolidayDate = isHoliday(attDate);
            const isWeekendDate = isWeekend(attDate);
            const isOffDay = isWeeklyOff(attDate);
            const isOnHolidayOrOff = isHolidayDate || isOffDay;

            // Skip if already covered by overtime request (unless it's a holiday/off day - those always count)
            if (overtimeRequestDates.has(attDateString) && !isOnHolidayOrOff) {
                continue;
            }

            // Get overtimeHours from attendance record (already calculated by attendance service)
            // Convert to Decimal if it's not already
            let otHours: Decimal | null = null;
            if (attendance.overtimeHours) {
                otHours = attendance.overtimeHours instanceof Decimal
                    ? attendance.overtimeHours
                    : new Decimal(attendance.overtimeHours);
            }

            // For holidays/off days: use overtimeHours if available, otherwise all working hours are overtime
            if (isOnHolidayOrOff && attendance.checkIn && attendance.checkOut) {
                if (!otHours || otHours.eq(0)) {
                    // If no overtimeHours calculated, use workingHours (all hours worked are overtime on holidays/off days)
                    otHours = attendance.workingHours
                        ? (attendance.workingHours instanceof Decimal
                            ? attendance.workingHours
                            : new Decimal(attendance.workingHours))
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

    private async calculateTax(salaryBreakup: Array<{ id: string; name: string; percentage: number | null; amount: number; isTaxable?: boolean }>, rebates: any[], packageAmount: Decimal): Promise<{ taxDeduction: Decimal; taxBreakup: any }> {
        // Calculate taxable income from salary breakup components only (not gross salary)
        // Include ALL salary components (Basic Salary, House Rent, Utility, etc.) in taxable income
        // Sum up amounts from components marked as taxable (default is taxable unless explicitly marked as non-taxable)
        let monthlyTaxableAmount = new Decimal(0);
        const taxableComponents: Array<{ name: string; amount: number }> = [];

        for (const component of salaryBreakup) {
            // Include component if it's marked as taxable (default is true) and has amount > 0
            // This ensures Basic Salary, House Rent, Utility, and all other salary components are included
            if (component.isTaxable !== false && component.amount > 0) {
                monthlyTaxableAmount = monthlyTaxableAmount.add(new Decimal(component.amount));
                taxableComponents.push({
                    name: component.name,
                    amount: component.amount,
                });
            }
        }

        // Convert to annual taxable income
        const annualTaxableIncome = monthlyTaxableAmount.mul(12);

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
        let taxSlabUsed: { minAmount: number; maxAmount: number; rate: number } | null = null;
        let fixedAmountTax = new Decimal(0);
        let percentageTaxAmount = new Decimal(0);

        // Apply tax slab to taxable income
        if (taxableIncome.gt(0)) {
            const slab = await this.prisma.taxSlab.findFirst({
                where: {
                    minAmount: { lte: taxableIncome },
                    maxAmount: { gte: taxableIncome },
                    status: 'active',
                },
                orderBy: { minAmount: 'desc' }
            });

            if (slab) {
                taxSlabUsed = {
                    minAmount: Number(slab.minAmount),
                    maxAmount: Number(slab.maxAmount),
                    rate: Number(slab.rate),
                };

                // Calculate tax: Fixed amount from previous slabs + percentage on excess
                // Note: fixedAmount might not exist in Prisma type yet, using type assertion
                const slabFixedAmount = (slab as any).fixedAmount;
                fixedAmountTax = slabFixedAmount ? new Decimal(slabFixedAmount) : new Decimal(0);
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
