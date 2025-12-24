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
                allowances: { where: { status: 'active', month, year } },
                deductions: { where: { status: 'active', month, year } },
                loanRequests: { where: { status: 'approved' } },
                advanceSalaries: { where: { deductionMonth: month, deductionYear: year, status: 'approved' } },
                bonuses: { where: { bonusMonth: month, bonusYear: year, status: 'active' } },
                rebates: { where: { monthYear: `${year}-${month}`, status: 'approved' }, include: { rebateNature: true } },
            },
        });

        if (employees.length === 0) {
            throw new BadRequestException("No active employees found to generate payroll for.");
        }

        const salaryBreakups = await this.prisma.salaryBreakup.findMany({
            where: { status: 'active' }
        });

        const previewData: any[] = []; // Explicitly type as any[] or define an interface

        for (const employee of employees) {
            // "employeeSalary" is treated as the Total Monthly Package (Gross before ad-hoc)
            const packageAmount = new Decimal(employee.employeeSalary);

            // Calculate breakup components
            const salaryBreakup = salaryBreakups.map(breakup => {
                let amount = new Decimal(0);
                if (breakup.percentage) {
                    amount = packageAmount.mul(breakup.percentage).div(100);
                }
                return {
                    id: breakup.id,
                    name: breakup.name,
                    percentage: breakup.percentage,
                    amount: amount.toNumber()
                };
            });

            // Find "Basic Salary" component for rate calculations
            const basicComponent = salaryBreakup.find(b => b.name === 'Basic Salary');
            const calculatedBasicSalary = basicComponent ? new Decimal(basicComponent.amount) : packageAmount; // Fallback to package if no basic defined

            // A. Calculate Allowances (Ad-hoc additional allowances)
            const totalAdHocAllowances = this.calculateAllowances(employee.allowances);

            // B. Calculate Overtime (Using calculated Basic Salary for rate)
            const overtimeAmount = await this.calculateOvertime(employee, month, year, employee.workingHoursPolicy, calculatedBasicSalary);

            // C. Calculate Attendance Deductions (Lates/Absents) (using calculated Basic Salary for rate)
            const attendanceDeduction = await this.calculateAttendanceDeductions(employee, month, year, employee.workingHoursPolicy, calculatedBasicSalary);

            // D. Calculate Bonuses
            const bonusAmount = this.calculateBonuses(employee.bonuses);

            // E. Calculate Gross Salary (Pre-tax)
            // Gross = Package + AdHoc Allowances + Overtime + Bonus
            const grossSalary = packageAmount.add(totalAdHocAllowances).add(overtimeAmount).add(bonusAmount);

            // F. Calculate Tax (with Rebates)
            const taxDeduction = await this.calculateTax(grossSalary, employee.rebates);

            // G. Calculate EOBI & PF
            const { eobiDeduction, providentFundDeduction } = this.calculateEOBI_PF(employee);

            // H. Calculate Loans & Advances
            const { loanDeduction, advanceSalaryDeduction } = this.calculateLoansAndAdvances(employee, month, year);

            // I. Other Ad-hoc Deductions
            const totalAdHocDeductions = this.calculateAdHocDeductions(employee.deductions);

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
                totalAllowances: totalAdHocAllowances.toNumber(),
                totalDeductions: totalAdHocDeductions.toNumber(),
                attendanceDeduction: attendanceDeduction.toNumber(),
                loanDeduction: loanDeduction.toNumber(),
                advanceSalaryDeduction: advanceSalaryDeduction.toNumber(),
                eobiDeduction: eobiDeduction.toNumber(),
                providentFundDeduction: providentFundDeduction.toNumber(),
                taxDeduction: taxDeduction.toNumber(),
                overtimeAmount: overtimeAmount.toNumber(),
                bonusAmount: bonusAmount.toNumber(),
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
            // Check if payroll already exists
            let payroll = await this.prisma.payroll.findUnique({
                where: {
                    month_year: {
                        month,
                        year,
                    },
                },
            });

            if (payroll) {
                if (payroll.status !== 'draft') {
                    throw new BadRequestException('Payroll for this month is already processed/approved.');
                }
            } else {
                // Create new payroll header if not exists
                payroll = await this.prisma.payroll.create({
                    data: {
                        month,
                        year,
                        totalAmount: 0,
                        status: 'draft',
                        generatedBy: generatedBy ? { connect: { id: generatedBy } } : undefined,
                    }
                });
            }

            // Remove existing details for submitted employees
            const employeeIds = details.map(d => d.employeeId);
            await this.prisma.payrollDetail.deleteMany({
                where: {
                    payrollId: payroll.id,
                    employeeId: { in: employeeIds }
                }
            });

            const payrollDetailsData: Prisma.PayrollDetailCreateManyInput[] = details.map(d => ({
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
                grossSalary: new Decimal(d.grossSalary),
                netSalary: new Decimal(d.netSalary),
                paymentStatus: 'pending',
            }));

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
                data: { totalAmount: aggregate._sum.netSalary || new Decimal(0) }
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

    // --- Helper Methods ---

    private calculateAllowances(allowances: any[]): Decimal {
        // Sum up allowance amounts
        return allowances.reduce((sum, allow) => sum.add(new Decimal(allow.amount)), new Decimal(0));
    }

    private calculateBonuses(bonuses: any[]): Decimal {
        // Filter for paymentMethod 'with_salary'
        return bonuses
            .filter(b => b.paymentMethod === 'with_salary')
            .reduce((sum, b) => sum.add(new Decimal(b.amount)), new Decimal(0));
    }

    private calculateAdHocDeductions(deductions: any[]): Decimal {
        return deductions.reduce((sum, ded) => sum.add(new Decimal(ded.amount)), new Decimal(0));
    }

    private calculateEOBI_PF(employee: any) {
        let eobiDeduction = new Decimal(0);
        let providentFundDeduction = new Decimal(0);

        // Placeholder: Assuming fixed amount or configured via separate check. 
        // In a real scenario, this would fetch from a configuration table.
        if (employee.eobi) {
            eobiDeduction = new Decimal(0); // TODO: Fetch from EOBI Master
        }

        if (employee.providentFund) {
            providentFundDeduction = new Decimal(0); // TODO: Fetch from PF Master
        }

        return { eobiDeduction, providentFundDeduction };
    }

    private calculateLoansAndAdvances(employee: any, month: string, year: string) {
        let loanDeduction = new Decimal(0);
        let advanceSalaryDeduction = new Decimal(0);

        // Loans
        if (employee.loanRequests) {
            for (const loan of employee.loanRequests) {
                if (loan.repaymentStartMonthYear && loan.numberOfInstallments) {
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
        }

        // Advances
        if (employee.advanceSalaries) {
            for (const advance of employee.advanceSalaries) {
                advanceSalaryDeduction = advanceSalaryDeduction.add(new Decimal(advance.amount));
            }
        }

        return { loanDeduction, advanceSalaryDeduction };
    }

    private async calculateAttendanceDeductions(employee: any, month: string, year: string, policy: any, basicSalary: Decimal): Promise<Decimal> {
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

        // Calculate per day salary (assuming 30 days)
        const perDaySalary = basicSalary.div(30);

        // Counters
        for (const att of attendances) {
            if (att.status === 'absent') {
                absentCount++;
            } else if (att.status === 'late' || (att.lateMinutes && att.lateMinutes > 0)) {
                lateCount++;
            }
        }

        // Absent Deduction
        // Standard: Deduct full day salary per absent
        deduction = deduction.add(perDaySalary.mul(absentCount));

        // Late Deduction Logic
        if (policy && policy.applyDeductionAfterLates && lateCount >= policy.applyDeductionAfterLates) {
            // If lates exceed limit, deduct based on policy

            if (policy.lateDeductionPercent) {
                // Logic: "Apply deduction AFTER X lates". Usually means first X are free.
                // So: (lateCount - applyDeductionAfterLates) > 0 ?
                const chargeableLates = Math.max(0, lateCount - policy.applyDeductionAfterLates);

                if (chargeableLates > 0) {
                    const deductionPerLate = perDaySalary.mul(new Decimal(policy.lateDeductionPercent).div(100));
                    deduction = deduction.add(deductionPerLate.mul(chargeableLates));
                }
            }
        }

        return deduction;
    }

    private async calculateOvertime(employee: any, month: string, year: string, policy: any, basicSalary: Decimal): Promise<Decimal> {
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
            }
        });

        let amount = new Decimal(0);
        if (!employee.overtimeApplicable || !policy) return amount;

        for (const ot of overtimes) {
            // Calculate amount: Hours * Rate
            // Usually: (Basic / 30 / 8) * Factor * Hours

            const hourlyRate = basicSalary.div(30).div(8); // Use calculated basic salary

            let rateMultiplier = new Decimal(1);
            if (policy.overtimeRate) {
                rateMultiplier = new Decimal(policy.overtimeRate);
            }

            // Weekday
            const weekdayAmt = hourlyRate.mul(rateMultiplier).mul(new Decimal(ot.weekdayOvertimeHours || 0));

            // Holiday
            let holidayMultiplier = rateMultiplier;
            if (policy.gazzetedOvertimeRate) {
                holidayMultiplier = new Decimal(policy.gazzetedOvertimeRate);
            }
            const holidayAmt = hourlyRate.mul(holidayMultiplier).mul(new Decimal(ot.holidayOvertimeHours || 0));

            amount = amount.add(weekdayAmt).add(holidayAmt);
        }

        return amount;
    }

    private async calculateTax(grossSalary: Decimal, rebates: any[]): Promise<Decimal> {
        const annualIncome = grossSalary.mul(12);

        let taxableIncome = annualIncome;
        if (rebates) {
            for (const rebate of rebates) {
                taxableIncome = taxableIncome.minus(new Decimal(rebate.rebateAmount));
            }
        }

        if (taxableIncome.lte(0)) return new Decimal(0);

        const slab = await this.prisma.taxSlab.findFirst({
            where: {
                minAmount: { lte: taxableIncome },
                maxAmount: { gte: taxableIncome },
            }
        });

        if (!slab) {
            return new Decimal(0);
        }

        const excess = taxableIncome.minus(new Decimal(slab.minAmount));
        // Assuming rate is percentage
        const annualTax = excess.mul(new Decimal(slab.rate).div(100));

        return annualTax.div(12);
    }
}
